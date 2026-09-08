import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import {
  AdminError,
  type AdminEnvironment,
  type AdminService,
} from "../usecases/admin.js";
import {
  AuthenticationError,
  AuthorizationError,
  type Principal,
} from "../usecases/ports.js";
import { BillingError } from "../domain/billing.js";
import { catalogSchema } from "./billing.js";
import { adminHtml, adminScript, adminStyle } from "./admin_ui.js";

export type AdminCapability =
  | "admin:read"
  | "admin:grants:write"
  | "billing:configure";
export type AdminHttpOptions<B extends object> = {
  environment: AdminEnvironment;
  productName: string;
  service: (bindings: B) => AdminService;
  authenticate: (request: Request, bindings: B) => Promise<Principal>;
  authorize: (
    principal: Principal,
    capability: AdminCapability,
    environment: AdminEnvironment,
  ) => boolean | Promise<boolean>;
  /** Absolute HTTPS mount URL, also the CSRF and navigation trust boundary. */
  url: string;
  environments: readonly { name: string; url: string }[];
};
const text = z.string().trim().min(1).max(200);
const reason = z.string().trim().min(1).max(2000);
const snapshot = z
  .object({
    planId: text,
    grantEndsAt: z.string().nullable(),
    capabilities: z.record(
      z.string(),
      z
        .object({
          limit: z.number().nullable(),
          period: z.enum(["utc_month", "lifetime"]),
          used: z.number(),
          periodKey: z.string(),
        })
        .strict(),
    ),
  })
  .strict();
const grantInput = z
  .object({
    id: z.string().uuid(),
    ownerSub: text,
    planId: text,
    endsAt: z.iso.datetime().transform((v) => new Date(v).toISOString()),
    reason,
    expectedMembership: snapshot,
    expectedCatalogRevision: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
    environment: z.enum(["production", "sandbox"]),
  })
  .strict();

/** Optional mount; the host supplies verified OIDC/session authentication and explicit policy. */
export function createAdmin<B extends object>(options: AdminHttpOptions<B>) {
  const base = new URL(options.url);
  if (
    base.protocol !== "https:" ||
    base.search ||
    base.hash ||
    base.username ||
    base.password
  )
    throw new Error("Admin requires a fixed HTTPS mount URL.");
  for (const e of options.environments)
    if (new URL(e.url).origin !== base.origin)
      throw new Error("Admin environment links must be same-origin.");
  const app = new Hono<{ Bindings: B }>();
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Content-Type-Options", "nosniff");
    c.header(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    if (new URL(c.req.url).origin !== base.origin)
      throw new AuthorizationError();
    if (
      !["GET", "HEAD"].includes(c.req.method) &&
      c.req.header("Origin") !== base.origin
    )
      throw new AuthorizationError(
        "A same-origin management request is required.",
      );
    await next();
  });
  app.use("*", bodyLimit({ maxSize: 64 * 1024 }));
  app.onError((error, c) => {
    const status =
      error instanceof AuthenticationError
        ? 401
        : error instanceof AuthorizationError
          ? 403
          : error instanceof AdminError
            ? error.status
            : error instanceof z.ZodError || error instanceof SyntaxError
              ? 422
              : error instanceof BillingError
                ? error.code === "PRECONDITION_FAILED"
                  ? 412
                  : 422
                : 500;
    if (status === 401) c.header("WWW-Authenticate", "Bearer");
    return c.json(
      {
        type: "about:blank",
        title: "Administration request failed",
        status,
        detail:
          status === 500
            ? "The operation failed. Reload to check the result before retrying."
            : error.message,
      },
      status,
      { "Content-Type": "application/problem+json" },
    );
  });
  const authorize = async (
    request: Request,
    env: B,
    capability: AdminCapability,
  ) => {
    const p = await options.authenticate(request, env);
    // Every capability requires entry permission as well as its narrower write permission.
    if (
      !(await options.authorize(p, "admin:read", options.environment)) ||
      !(await options.authorize(p, capability, options.environment))
    )
      throw new AuthorizationError();
    return p;
  };
  const service = (env: B) => {
    const result = options.service(env);
    if (result.grants.environment !== options.environment)
      throw new Error("Admin environment mismatch.");
    return result;
  };
  const confirmEnvironment = (environment: string) => {
    if (environment !== options.environment)
      throw new AdminError(
        409,
        "The selected environment changed. Reload before writing.",
      );
  };
  app.get("/", (c) =>
    c.html(adminHtml(base.pathname.replace(/\/$/u, ""), options.productName)),
  );
  app.get("/admin.js", (c) =>
    c.body(adminScript, 200, { "Content-Type": "text/javascript" }),
  );
  app.get("/admin.css", (c) =>
    c.body(adminStyle, 200, { "Content-Type": "text/css" }),
  );
  app.get("/context", async (c) => {
    const p = await authorize(c.req.raw, c.env, "admin:read");
    return c.json({
      environment: options.environment,
      productName: options.productName,
      operator: p.sub,
      environments: options.environments,
      canGrant: await options.authorize(
        p,
        "admin:grants:write",
        options.environment,
      ),
      canConfigure: await options.authorize(
        p,
        "billing:configure",
        options.environment,
      ),
    });
  });
  app.get("/users", async (c) => {
    await authorize(c.req.raw, c.env, "admin:read");
    return c.json(await service(c.env).user(text.parse(c.req.query("query"))));
  });
  app.get("/manual-grants", async (c) => {
    await authorize(c.req.raw, c.env, "admin:read");
    const rows = await service(c.env).grants.list(
      text.parse(c.req.query("ownerSub")),
      z.string().uuid().optional().parse(c.req.query("before")),
    );
    return c.json({
      items: rows.slice(0, 50),
      next: rows.length > 50 ? rows[49]!.id : null,
    });
  });
  app.post("/manual-grants", async (c) => {
    const p = await authorize(c.req.raw, c.env, "admin:grants:write");
    const input = grantInput.parse(await c.req.json());
    confirmEnvironment(input.environment);
    const result = await service(c.env).create(input, p.sub);
    c.header(
      "Location",
      `${options.url.replace(/\/$/u, "")}/manual-grants/${result.id}`,
    );
    return c.json(result, 201);
  });
  app.get("/manual-grants/:id", async (c) => {
    await authorize(c.req.raw, c.env, "admin:read");
    const grant = await service(c.env).grants.get(
      z.string().uuid().parse(c.req.param("id")),
    );
    if (!grant) throw new AdminError(404, "Manual grant not found.");
    return c.json(grant);
  });
  app.put("/manual-grants/:id/revocation", async (c) => {
    const p = await authorize(c.req.raw, c.env, "admin:grants:write");
    const input = z
      .object({ reason, environment: z.enum(["production", "sandbox"]) })
      .strict()
      .parse(await c.req.json());
    confirmEnvironment(input.environment);
    return c.json(
      await service(c.env).revoke(
        z.string().uuid().parse(c.req.param("id")),
        input.reason,
        p.sub,
      ),
    );
  });
  app.get("/catalog", async (c) => {
    await authorize(c.req.raw, c.env, "admin:read");
    const result = await service(c.env).billing.catalog();
    c.header("ETag", `"${result.revision}"`);
    return c.json(result.catalog);
  });
  app.put("/catalog", async (c) => {
    await authorize(c.req.raw, c.env, "billing:configure");
    confirmEnvironment(c.req.header("Admin-Environment") ?? "");
    const etag = c.req.header("If-Match");
    if (!etag)
      return c.json({ detail: "If-Match is required.", status: 428 }, 428);
    const match = /^"(0|[1-9][0-9]*)"$/u.exec(etag);
    if (!match || !Number.isSafeInteger(Number(match[1])))
      throw new AdminError(422, "Invalid catalog revision.");
    const result = await service(c.env).billing.replaceCatalog(
      catalogSchema.parse(await c.req.json()),
      Number(match[1]),
    );
    c.header("ETag", `"${result.revision}"`);
    return c.json(result.catalog);
  });
  // Hono normalizes a mounted child root to /admin; also serve its canonical /admin/ URL.
  app.get("/*", (c) =>
    new URL(c.req.url).pathname === base.pathname.replace(/\/$/u, "") + "/"
      ? c.html(
          adminHtml(base.pathname.replace(/\/$/u, ""), options.productName),
        )
      : c.notFound(),
  );
  return app;
}
