import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { EncryptJWT, jwtDecrypt } from "jose";
import * as oauth from "oauth4webapi";
import {
  AuthenticationError,
  type AuthVerifier,
  type Principal,
} from "../usecases/ports.js";

export interface AdminSessionStore {
  startAttempt(idHash: string, expiresAt: number): Promise<void>;
  consumeAttempt(idHash: string, now: number): Promise<boolean>;
  put(idHash: string, principal: Principal, expiresAt: number): Promise<void>;
  get(idHash: string, now: number): Promise<Principal | null>;
  delete(idHash: string): Promise<void>;
}
export type AdminOidcOptions = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  audience: string;
  /** Fixed HTTPS admin mount; callback is mount + /session/callback. */
  url: string;
  scopes: readonly string[];
  /** 32-byte Worker secret for the short-lived encrypted login attempt cookie. */
  cookieKey: Uint8Array;
  sessions: AdminSessionStore;
  verifier: AuthVerifier;
};
const sessionCookie = "__Host-appbase-admin";
const attemptCookie = "__Host-appbase-admin-login";
const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "Lax" as const,
  path: "/",
};
export async function adminSessionHash(id: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(id)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
/** Confidential OIDC BFF. OAuth tokens never leave the callback or persist in sessions. */
export function createAdminOidc(options: AdminOidcOptions) {
  const url = new URL(options.url);
  if (
    url.protocol !== "https:" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    options.cookieKey.byteLength !== 32
  )
    throw new Error(
      "Admin OIDC requires an HTTPS mount and a 32-byte cookie key.",
    );
  const base = options.url.replace(/\/$/u, "");
  const redirectUri = base + "/session/callback";
  const client: oauth.Client = { client_id: options.clientId };
  let metadata: Promise<oauth.AuthorizationServer> | undefined;
  const server = () =>
    (metadata ??= oauth
      .discoveryRequest(new URL(options.issuer))
      .then((r) => oauth.processDiscoveryResponse(new URL(options.issuer), r)));
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    if (new URL(c.req.url).origin !== url.origin)
      throw new AuthenticationError();
    await next();
  });
  app.onError((_error, c) =>
    c.html(
      "<h1>Sign-in failed</h1><p>The login attempt expired or could not be verified. Start sign-in again.</p>",
      401,
    ),
  );
  app.get("/login", async (c) => {
    const as = await server();
    const verifier = oauth.generateRandomCodeVerifier(),
      state = oauth.generateRandomState(),
      nonce = oauth.generateRandomNonce();
    const attempt = await new EncryptJWT({ verifier, state, nonce })
      .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
      .setAudience(base)
      .setIssuedAt()
      .setExpirationTime("5m")
      .encrypt(options.cookieKey);
    await options.sessions.startAttempt(
      await adminSessionHash(state),
      Date.now() + 300_000,
    );
    setCookie(c, attemptCookie, attempt, { ...cookieOptions, maxAge: 300 });
    const authorization = new URL(as.authorization_endpoint!);
    for (const [key, value] of Object.entries({
      client_id: options.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: ["openid", ...options.scopes].join(" "),
      resource: options.audience,
      state,
      nonce,
      code_challenge: await oauth.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256",
    }))
      authorization.searchParams.set(key, value);
    return c.redirect(authorization.href);
  });
  app.get("/callback", async (c) => {
    const cookie = getCookie(c, attemptCookie);
    deleteCookie(c, attemptCookie, cookieOptions);
    if (!cookie) throw new AuthenticationError();
    const { payload } = await jwtDecrypt(cookie, options.cookieKey, {
      audience: base,
    });
    if (
      typeof payload.state !== "string" ||
      typeof payload.nonce !== "string" ||
      typeof payload.verifier !== "string"
    )
      throw new AuthenticationError();
    const as = await server();
    const params = oauth.validateAuthResponse(
      as,
      client,
      new URL(c.req.url),
      payload.state,
    );
    if (
      !(await options.sessions.consumeAttempt(
        await adminSessionHash(payload.state),
        Date.now(),
      ))
    )
      throw new AuthenticationError(
        "The login attempt expired or was already used.",
      );
    const response = await oauth.authorizationCodeGrantRequest(
      as,
      client,
      oauth.ClientSecretPost(options.clientSecret),
      params,
      redirectUri,
      payload.verifier,
      { additionalParameters: { resource: options.audience } },
    );
    const result = await oauth.processAuthorizationCodeResponse(
      as,
      client,
      response,
      { expectedNonce: payload.nonce, requireIdToken: true },
    );
    await oauth.validateApplicationLevelSignature(as, response);
    const p = await options.verifier.verify(result.access_token);
    const claims = oauth.getValidatedIdTokenClaims(result);
    if (
      !claims ||
      claims.sub !== p.sub ||
      typeof result.expires_in !== "number" ||
      result.expires_in <= 0
    )
      throw new AuthenticationError();
    const previous = getCookie(c, sessionCookie);
    if (previous)
      await options.sessions.delete(await adminSessionHash(previous));
    const id = oauth.generateRandomState();
    const duration = Math.min(
      300,
      result.expires_in,
      claims.exp - Math.floor(Date.now() / 1000),
    );
    if (duration <= 0) throw new AuthenticationError();
    await options.sessions.put(
      await adminSessionHash(id),
      p,
      Date.now() + duration * 1000,
    );
    setCookie(c, sessionCookie, id, { ...cookieOptions, maxAge: duration });
    return c.redirect(base + "/");
  });
  app.get("/logout", (c) =>
    c.html(
      '<h1>Sign out of administration</h1><form method="post"><button>Sign out</button></form>',
    ),
  );
  app.post("/logout", async (c) => {
    if (c.req.header("Origin") !== url.origin) throw new AuthenticationError();
    const id = getCookie(c, sessionCookie);
    if (id) await options.sessions.delete(await adminSessionHash(id));
    deleteCookie(c, sessionCookie, cookieOptions);
    return c.redirect(base + "/");
  });
  return {
    app,
    authenticate: async (request: Request): Promise<Principal> => {
      // Parse through Hono's cookie helper using a minimal request context is unnecessary.
      const id = request.headers
        .get("Cookie")
        ?.split(/;\s*/u)
        .find((v) => v.startsWith(sessionCookie + "="))
        ?.slice(sessionCookie.length + 1);
      if (!id) throw new AuthenticationError();
      const principal = await options.sessions.get(
        await adminSessionHash(id),
        Date.now(),
      );
      if (!principal)
        throw new AuthenticationError("The administration session expired.");
      return principal;
    },
  };
}
