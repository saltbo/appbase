import { Hono, type Context } from "hono";
import { z } from "zod";

import { InvalidCursorError } from "../domain/cursor.js";
import type { JsonObject, SyncMutation } from "../domain/sync.js";
import {
  MembershipService,
  type MembershipConfig,
} from "../usecases/membership.js";
import type { MembershipRepository } from "../usecases/membership_ports.js";
import {
  AuthenticationError,
  AuthorizationError,
  type Principal,
  SyncConflictError,
} from "../usecases/ports.js";
import { pullChanges, pushMutations, type SyncDeps } from "../usecases/sync.js";

export const APPBASE_PROTOCOL_VERSION = "2026-08-17";

const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/u);
const mutationSchema = z
  .object({
    mutationId: identifierSchema,
    deviceId: identifierSchema,
    collection: identifierSchema,
    recordId: identifierSchema,
    baseRevision: z.string().uuid().nullable(),
    operation: z.enum(["put", "delete"]),
    payload: z.record(z.string(), z.json()).optional(),
  })
  .superRefine((value, context) => {
    if (value.operation === "put" && value.payload === undefined) {
      context.addIssue({
        code: "custom",
        path: ["payload"],
        message: "A put mutation requires a payload.",
      });
    }
    if (value.operation === "delete" && value.payload !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["payload"],
        message: "A delete mutation cannot include a payload.",
      });
    }
  });
const batchSchema = z.object({ mutations: z.array(mutationSchema).min(1) });
const pageSizeSchema = z.coerce.number().int().min(1);

type Variables = { authPrincipal: Principal; requestId: string };
type AppBaseContext<TBindings extends object> = Context<{
  Bindings: TBindings;
  Variables: Variables;
}>;

export type AppBasePublicConfig = {
  protocolVersions: readonly string[];
  issuer: string;
  clientId: string;
  audience: string;
  usesResourceIndicator: boolean;
  acceptsDynamicCollections: true;
  encryptsAllPayloads: true;
  maxMutationsPerBatch: number;
  maxChangesPerPage: number;
  maxPayloadBytes: number;
};

export type AppBaseCapability = "sync:read" | "sync:write" | "membership:read";

export type AppBaseHttpOptions<TBindings extends object> = {
  createDeps: (bindings: TBindings) => SyncDeps;
  publicConfig: AppBasePublicConfig;
  principal: (context: AppBaseContext<TBindings>) => Principal;
  authorize?: (
    principal: Principal,
    capability: AppBaseCapability,
  ) => boolean | Promise<boolean>;
  membership?: {
    config: MembershipConfig;
    repository: (bindings: TBindings) => MembershipRepository;
  };
  legacyV1?: boolean;
  problemTypeBase?: string;
  observe?: (event: AppBaseRequestEvent) => void;
  reportError?: (error: unknown, requestId: string) => void;
};

export type AppBaseRequestEvent = {
  requestId: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  traceparent?: string;
};

export function createAppBase<TBindings extends object>(
  options: AppBaseHttpOptions<TBindings>,
): Hono<{ Bindings: TBindings; Variables: Variables }> {
  validateConfig(options.publicConfig);
  const app = new Hono<{ Bindings: TBindings; Variables: Variables }>();

  app.use("*", async (context, next) => {
    const startedAt = performance.now();
    const requestId =
      context.req.header("Request-Id")?.trim() || crypto.randomUUID();
    context.set("requestId", requestId);
    await next();
    context.header("Request-Id", requestId);
    const traceparent = context.req.header("traceparent");
    if (traceparent !== undefined) context.header("traceparent", traceparent);
    options.observe?.({
      requestId,
      method: context.req.method,
      path: context.req.path,
      status: context.res.status,
      durationMs: performance.now() - startedAt,
      ...(traceparent === undefined ? {} : { traceparent }),
    });
  });

  app.onError((error, context) => {
    options.reportError?.(error, context.get("requestId"));
    if (error instanceof InvalidCursorError) {
      return problem(
        options,
        context,
        400,
        "INVALID_PAGE_TOKEN",
        error.message,
      );
    }
    if (error instanceof UnsupportedProtocolVersionError) {
      return problem(
        options,
        context,
        400,
        "UNSUPPORTED_API_VERSION",
        error.message,
        {
          supported: error.supported,
        },
      );
    }
    if (error instanceof PayloadTooLargeError) {
      return problem(options, context, 413, "PAYLOAD_TOO_LARGE", error.message);
    }
    if (error instanceof AuthenticationError) {
      return problem(options, context, 401, "UNAUTHENTICATED", error.message);
    }
    if (error instanceof AuthorizationError) {
      return problem(options, context, 403, "FORBIDDEN", error.message);
    }
    if (error instanceof SyncConflictError) {
      return problem(
        options,
        context,
        409,
        "SYNC_CONFLICT",
        "The record remained concurrently modified after bounded retries.",
      );
    }
    return problem(
      options,
      context,
      500,
      "INTERNAL_ERROR",
      "The AppBase request could not be completed.",
    );
  });

  app.get("/client-configuration", (context) =>
    context.json({ ...options.publicConfig, links: {} }, 200, {
      "Cache-Control": "public, max-age=300",
    }),
  );

  app.put("/mutation-batches/:batchId", async (context) => {
    requireProtocolVersion(options, context);
    const principal = await authorizedPrincipal(options, context, "sync:write");
    const batchId = identifierSchema.safeParse(context.req.param("batchId"));
    if (!batchId.success) {
      return validationProblem(
        options,
        context,
        "The mutation batch identifier is invalid.",
        batchId.error.issues,
      );
    }
    const body = await readJson(
      context.req.raw,
      maxBatchBytes(options.publicConfig),
    );
    const parsed = batchSchema.safeParse(body);
    if (
      !parsed.success ||
      parsed.data.mutations.length > options.publicConfig.maxMutationsPerBatch
    ) {
      return validationProblem(
        options,
        context,
        "The mutation batch is invalid.",
        parsed.success
          ? [
              {
                path: ["mutations"],
                message: `At most ${options.publicConfig.maxMutationsPerBatch} mutations are allowed.`,
              },
            ]
          : parsed.error.issues,
      );
    }
    const oversized = parsed.data.mutations.find(
      (mutation) =>
        mutation.payload !== undefined &&
        jsonBytes(mutation.payload) > options.publicConfig.maxPayloadBytes,
    );
    if (oversized !== undefined) {
      return problem(
        options,
        context,
        413,
        "PAYLOAD_TOO_LARGE",
        "A mutation payload exceeds the configured byte limit.",
      );
    }
    const results = await pushMutations(
      options.createDeps(context.env),
      principal.sub,
      parsed.data.mutations.map(toMutation),
    );
    return context.json(
      {
        id: batchId.data,
        results,
        links: { self: new URL(context.req.url).toString() },
      },
      200,
      { "Cache-Control": "no-store" },
    );
  });

  app.get("/changes", async (context) => {
    requireProtocolVersion(options, context);
    const principal = await authorizedPrincipal(options, context, "sync:read");
    const pageSize = pageSizeSchema
      .max(options.publicConfig.maxChangesPerPage)
      .default(Math.min(200, options.publicConfig.maxChangesPerPage))
      .safeParse(context.req.query("pageSize"));
    if (!pageSize.success) {
      return validationProblem(
        options,
        context,
        "The change page size is invalid.",
        pageSize.error.issues,
      );
    }
    const result = await pullChanges(
      options.createDeps(context.env),
      principal.sub,
      context.req.query("pageToken"),
      pageSize.data,
    );
    return context.json(
      {
        items: result.changes,
        pagination: {
          pageSize: pageSize.data,
          ...(result.hasMore ? { nextPageToken: result.cursor } : {}),
          checkpoint: result.cursor,
        },
      },
      200,
      { "Cache-Control": "private, no-store" },
    );
  });

  if (options.membership !== undefined) {
    app.get("/account-membership", async (context) => {
      requireProtocolVersion(options, context);
      const principal = await authorizedPrincipal(
        options,
        context,
        "membership:read",
      );
      const service = new MembershipService(
        options.membership!.repository(context.env),
        options.membership!.config,
      );
      return context.json(await service.snapshot(principal.sub), 200, {
        "Cache-Control": "private, no-store",
      });
    });
  }

  if (options.legacyV1 === true) registerLegacyRoutes(app, options);
  return app;
}

function registerLegacyRoutes<TBindings extends object>(
  app: Hono<{ Bindings: TBindings; Variables: Variables }>,
  options: AppBaseHttpOptions<TBindings>,
): void {
  app.get("/config", (context) =>
    context.json({ data: legacyConfiguration(options.publicConfig) }, 200, {
      "Cache-Control": "public, max-age=300",
      Deprecation: "true",
    }),
  );

  app.post("/sync/mutations", async (context) => {
    const principal = await authorizedPrincipal(options, context, "sync:write");
    const body = await readJson(
      context.req.raw,
      maxBatchBytes(options.publicConfig),
    );
    const parsed = batchSchema.safeParse(body);
    if (
      !parsed.success ||
      parsed.data.mutations.length > options.publicConfig.maxMutationsPerBatch
    ) {
      return validationProblem(
        options,
        context,
        "The mutation batch is invalid.",
        parsed.success ? undefined : parsed.error.issues,
      );
    }
    const results = await pushMutations(
      options.createDeps(context.env),
      principal.sub,
      parsed.data.mutations.map(toMutation),
    );
    return context.json({ results }, 200, {
      "Cache-Control": "no-store",
      Deprecation: "true",
    });
  });

  app.get("/sync/changes", async (context) => {
    const principal = await authorizedPrincipal(options, context, "sync:read");
    const limit = pageSizeSchema
      .max(options.publicConfig.maxChangesPerPage)
      .default(Math.min(200, options.publicConfig.maxChangesPerPage))
      .safeParse(context.req.query("limit"));
    if (!limit.success)
      return validationProblem(
        options,
        context,
        "The pull limit is invalid.",
        limit.error.issues,
      );
    const result = await pullChanges(
      options.createDeps(context.env),
      principal.sub,
      context.req.query("cursor"),
      limit.data,
    );
    return context.json(result, 200, {
      "Cache-Control": "private, no-store",
      Deprecation: "true",
    });
  });

  if (options.membership !== undefined) {
    app.get("/membership", async (context) => {
      const principal = await authorizedPrincipal(
        options,
        context,
        "membership:read",
      );
      const service = new MembershipService(
        options.membership!.repository(context.env),
        options.membership!.config,
      );
      return context.json(
        { data: await service.snapshot(principal.sub) },
        200,
        {
          "Cache-Control": "private, no-store",
          Deprecation: "true",
        },
      );
    });
  }
}

async function authorizedPrincipal<TBindings extends object>(
  options: AppBaseHttpOptions<TBindings>,
  context: AppBaseContext<TBindings>,
  capability: AppBaseCapability,
): Promise<Principal> {
  const principal = options.principal(context);
  if (
    options.authorize !== undefined &&
    !(await options.authorize(principal, capability))
  ) {
    throw new AuthorizationError();
  }
  return principal;
}

function requireProtocolVersion<TBindings extends object>(
  options: AppBaseHttpOptions<TBindings>,
  context: AppBaseContext<TBindings>,
): void {
  const requested = context.req.header("API-Version");
  if (
    requested === undefined ||
    !options.publicConfig.protocolVersions.includes(requested)
  ) {
    throw new UnsupportedProtocolVersionError(
      options.publicConfig.protocolVersions,
    );
  }
  context.header("API-Version", requested);
}

class UnsupportedProtocolVersionError extends Error {
  constructor(readonly supported: readonly string[]) {
    super("The requested AppBase protocol version is not supported.");
    this.name = "UnsupportedProtocolVersionError";
  }
}

function toMutation(value: z.infer<typeof mutationSchema>): SyncMutation {
  return {
    mutationId: value.mutationId,
    deviceId: value.deviceId,
    collection: value.collection,
    recordId: value.recordId,
    baseRevision: value.baseRevision,
    operation: value.operation,
    ...(value.payload === undefined
      ? {}
      : { payload: value.payload as JsonObject }),
  };
}

async function readJson(
  request: Request,
  maximumBytes: number,
): Promise<unknown> {
  if (
    !(request.headers.get("content-type") ?? "")
      .toLowerCase()
      .includes("application/json")
  )
    return null;
  const declared = Number.parseInt(
    request.headers.get("content-length") ?? "0",
    10,
  );
  if (Number.isFinite(declared) && declared > maximumBytes)
    throw new PayloadTooLargeError();
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maximumBytes)
    throw new PayloadTooLargeError();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

class PayloadTooLargeError extends Error {
  constructor() {
    super("The request body exceeds the configured byte limit.");
    this.name = "PayloadTooLargeError";
  }
}

function legacyConfiguration(config: AppBasePublicConfig): object {
  return {
    protocolVersion: 1,
    issuer: config.issuer,
    clientId: config.clientId,
    audience: config.audience,
    usesResourceIndicator: config.usesResourceIndicator,
    acceptsDynamicCollections: config.acceptsDynamicCollections,
    encryptsAllPayloads: config.encryptsAllPayloads,
    maxMutationsPerPush: config.maxMutationsPerBatch,
    maxChangesPerPull: config.maxChangesPerPage,
  };
}

function validateConfig(config: AppBasePublicConfig): void {
  if (
    config.protocolVersions.length === 0 ||
    !config.protocolVersions.includes(APPBASE_PROTOCOL_VERSION)
  ) {
    throw new Error(
      `AppBase public configuration must support ${APPBASE_PROTOCOL_VERSION}.`,
    );
  }
  for (const [name, value] of Object.entries({
    maxMutationsPerBatch: config.maxMutationsPerBatch,
    maxChangesPerPage: config.maxChangesPerPage,
    maxPayloadBytes: config.maxPayloadBytes,
  })) {
    if (!Number.isSafeInteger(value) || value < 1)
      throw new Error(`${name} must be a positive integer.`);
  }
}

function maxBatchBytes(config: AppBasePublicConfig): number {
  return config.maxMutationsPerBatch * config.maxPayloadBytes + 64 * 1024;
}

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function validationProblem<TBindings extends object>(
  options: AppBaseHttpOptions<TBindings>,
  context: AppBaseContext<TBindings>,
  detail: string,
  errors?: unknown,
): Response {
  return problem(options, context, 422, "VALIDATION_ERROR", detail, errors);
}

function problem<TBindings extends object>(
  options: AppBaseHttpOptions<TBindings>,
  context: AppBaseContext<TBindings>,
  status: 400 | 401 | 403 | 409 | 413 | 422 | 500,
  code: string,
  detail: string,
  errors?: unknown,
): Response {
  const base = (
    options.problemTypeBase ?? "https://appbase.dev/problems"
  ).replace(/\/+$/u, "");
  return context.json(
    {
      type: `${base}/${code.toLowerCase().replaceAll("_", "-")}`,
      title: problemTitle(status),
      status,
      detail,
      instance: context.req.path,
      code,
      requestId: context.get("requestId"),
      ...(errors === undefined ? {} : { errors }),
    },
    status,
    { "Cache-Control": "no-store", "Content-Type": "application/problem+json" },
  );
}

function problemTitle(status: number): string {
  if (status === 400) return "Bad Request";
  if (status === 401) return "Unauthorized";
  if (status === 403) return "Forbidden";
  if (status === 409) return "Conflict";
  if (status === 413) return "Content Too Large";
  if (status === 422) return "Unprocessable Content";
  return "Internal Server Error";
}
