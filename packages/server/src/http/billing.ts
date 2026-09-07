import { Hono } from "hono";
import { z } from "zod";
import { bodyLimit } from "hono/body-limit";
import { BillingError } from "../domain/billing.js";
import type { BillingService } from "../usecases/billing.js";
import {
  AuthenticationError,
  AuthorizationError,
  type Principal,
} from "../usecases/ports.js";
import {
  revenueCatEventSchema,
  verifyWebhookAuthorization,
} from "../adapters/revenuecat.js";

const id = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_.:-]+$/u);
const plan = z
  .object({
    id,
    capabilities: z.record(
      id,
      z
        .object({
          limit: z
            .number()
            .int()
            .nonnegative()
            .max(Number.MAX_SAFE_INTEGER)
            .nullable(),
          period: z.enum(["lifetime", "utc_month"]),
        })
        .strict(),
    ),
  })
  .strict();
const catalogSchema = z
  .object({
    freePlan: plan,
    plans: z.array(plan).min(1).max(30),
    entitlementPlans: z.record(id, id),
    honorGracePeriod: z.boolean(),
  })
  .strict();
export type BillingCapability =
  | "billing:read"
  | "billing:write"
  | "billing:configure";
export type BillingHttpOptions<B extends object> = {
  service: (bindings: B) => BillingService;
  authenticate: (request: Request, bindings: B) => Promise<Principal>;
  authorize: (
    principal: Principal,
    capability: BillingCapability,
  ) => boolean | Promise<boolean>;
  sdkKeys: (bindings: B) => { ios: string; android: string };
  webhookAuthorization: (bindings: B) => string;
};

/** Mount at /billing, outside user OIDC middleware; each route authenticates its own caller. */
export function createBilling<B extends object>(
  options: BillingHttpOptions<B>,
): Hono<{ Bindings: B }> {
  const app = new Hono<{ Bindings: B }>();
  app.use("*", bodyLimit({ maxSize: 64 * 1024 }));
  app.use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", "private, no-store");
  });
  app.onError((error, c) => {
    const status =
      error instanceof AuthenticationError
        ? 401
        : error instanceof AuthorizationError
          ? 403
          : error instanceof z.ZodError || error instanceof SyntaxError
            ? 422
            : error instanceof BillingError
              ? error.code === "PRECONDITION_FAILED"
                ? 412
                : error.code === "SYNC_SUPERSEDED"
                  ? 409
                  : error.code === "INVALID_CATALOG"
                    ? 422
                    : 502
              : 500;
    if (status === 401) c.header("WWW-Authenticate", "Bearer");
    return c.json(
      {
        type: "about:blank",
        title: "Billing request failed",
        status,
        code:
          error instanceof BillingError
            ? error.code
            : status === 401
              ? "UNAUTHENTICATED"
              : status === 403
                ? "FORBIDDEN"
                : "BILLING_ERROR",
        detail:
          status < 500
            ? error.message
            : "Billing could not complete the request.",
      },
      status,
      { "Content-Type": "application/problem+json" },
    );
  });
  const principal = async (
    request: Request,
    env: B,
    capability: BillingCapability,
  ) => {
    const p = await options.authenticate(request, env);
    if (!(await options.authorize(p, capability)))
      throw new AuthorizationError();
    return p;
  };
  app.get("/configuration", async (c) => {
    await principal(c.req.raw, c.env, "billing:configure");
    const config = await options.service(c.env).catalog();
    c.header("ETag", `"${config.revision}"`);
    return c.json(config.catalog);
  });
  app.put("/configuration", async (c) => {
    await principal(c.req.raw, c.env, "billing:configure");
    const header = c.req.header("If-Match");
    if (!header)
      return c.json(
        { type: "about:blank", title: "If-Match is required", status: 428 },
        428,
      );
    const match = /^"(0|[1-9][0-9]*)"$/u.exec(header);
    if (!match || !Number.isSafeInteger(Number(match[1])))
      throw new BillingError(
        "PRECONDITION_FAILED",
        "Use the catalog's current ETag.",
      );
    const config = await options
      .service(c.env)
      .replaceCatalog(
        catalogSchema.parse(await c.req.json()),
        Number(match[1]),
      );
    c.header("ETag", `"${config.revision}"`);
    return c.json(config.catalog);
  });
  app.get("/account", async (c) => {
    const p = await principal(c.req.raw, c.env, "billing:read");
    const service = options.service(c.env);
    return c.json({
      appUserId: await service.repository.identity(p.sub),
      sdkKeys: options.sdkKeys(c.env),
      state: await service.repository.state(p.sub),
    });
  });
  app.post("/synchronizations", async (c) => {
    const p = await principal(c.req.raw, c.env, "billing:write");
    return c.json(await options.service(c.env).synchronize(p.sub));
  });
  app.post("/webhooks/revenuecat", async (c) => {
    if (
      !(await verifyWebhookAuthorization(
        c.req.header("Authorization"),
        options.webhookAuthorization(c.env),
      ))
    )
      throw new AuthenticationError("Invalid webhook authorization.");
    const { event } = revenueCatEventSchema.parse(await c.req.json());
    const userIds = [
      event.app_user_id,
      event.original_app_user_id,
      ...(event.aliases ?? []),
      ...(event.transferred_from ?? []),
      ...(event.transferred_to ?? []),
    ].filter((id): id is string => id !== undefined);
    if (userIds.length === 0 && event.type !== "TEST")
      return c.json(
        {
          type: "about:blank",
          title: "A subscription event must identify its customer.",
          status: 422,
        },
        422,
      );
    await options.service(c.env).webhook({ id: event.id, userIds });
    return c.body(null, 204);
  });
  return app;
}
