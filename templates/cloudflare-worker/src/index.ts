import {
  APPBASE_PROTOCOL_VERSION,
  AuthenticationError,
  D1EnvelopeSecretCodec,
  D1SyncRepository,
  OidcAuthVerifier,
  createAppBase,
  type AppBaseCapability,
  type MasterKeyring,
  type Principal,
} from "@saltbo/appbase-server/cloudflare";
import { Hono } from "hono";

type Variables = { authPrincipal: Principal };

function createWorker(env: Env): Hono<{ Bindings: Env; Variables: Variables }> {
  const worker = new Hono<{ Bindings: Env; Variables: Variables }>();

  worker.use("/appbase/*", async (context, next) => {
    if (context.req.path === "/appbase/client-configuration") {
      await next();
      return;
    }
    const header = context.req.header("Authorization");
    if (header === undefined || !header.startsWith("Bearer ")) {
      throw new AuthenticationError();
    }
    const verifier = new OidcAuthVerifier(
      context.env.APPBASE_ISSUER,
      context.env.APPBASE_AUDIENCE,
    );
    context.set("authPrincipal", await verifier.verify(header.slice(7)));
    await next();
  });

  worker.route(
    "/appbase",
    createAppBase<Env>({
      publicConfig: {
        protocolVersions: [APPBASE_PROTOCOL_VERSION],
        issuer: env.APPBASE_ISSUER,
        clientId: env.APPBASE_CLIENT_ID,
        audience: env.APPBASE_AUDIENCE,
        usesResourceIndicator: true,
        acceptsDynamicCollections: true,
        encryptsAllPayloads: true,
        maxMutationsPerBatch: 50,
        maxChangesPerPage: 200,
        maxPayloadBytes: 65_536,
      },
      principal: (context) => context.get("authPrincipal"),
      authorize: (principal, capability) => hasScope(principal, capability),
      createDeps: (env) => ({
        repository: new D1SyncRepository(env.APPBASE_DB),
        secretCodec: new D1EnvelopeSecretCodec(
          env.APPBASE_DB,
          parseKeyring(env.APPBASE_MASTER_KEYRING),
        ),
        now: () => new Date(),
        createRevision: () => crypto.randomUUID(),
      }),
      observe: (event) =>
        console.log(JSON.stringify({ event: "appbase.request", ...event })),
      reportError: (error, requestId) =>
        console.error(
          JSON.stringify({
            event: "appbase.error",
            requestId,
            error: error instanceof Error ? error.name : "UnknownError",
          }),
        ),
    }),
  );
  return worker;
}

function hasScope(
  principal: Principal,
  capability: AppBaseCapability,
): boolean {
  const required =
    capability === "sync:read" ? "appbase:read" : "appbase:write";
  return principal.scopes.includes(required);
}

function parseKeyring(value: string): MasterKeyring {
  const parsed: unknown = JSON.parse(value);
  if (parsed === null || typeof parsed !== "object") {
    throw new Error("APPBASE_MASTER_KEYRING must be a JSON object.");
  }
  const candidate = parsed as Partial<MasterKeyring>;
  if (
    !Number.isSafeInteger(candidate.currentVersion) ||
    candidate.keys === null ||
    typeof candidate.keys !== "object"
  ) {
    throw new Error("APPBASE_MASTER_KEYRING is invalid.");
  }
  return { currentVersion: candidate.currentVersion!, keys: candidate.keys };
}

export default {
  fetch(request, env, context) {
    return createWorker(env).fetch(request, env, context);
  },
} satisfies ExportedHandler<Env>;
