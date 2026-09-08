import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { generateKeyPair, exportJWK, SignJWT, jwtDecrypt } from "jose";
import { createAdminOidc } from "../src/http/admin_oidc.js";
import { D1AdminSessionStore } from "../src/adapters/d1_admin_sessions.js";
import { OidcAuthVerifier } from "../src/adapters/oidc_auth_verifier.js";
import { sqlite } from "./admin_support.js";
afterEach(() => vi.unstubAllGlobals());
async function fixture() {
  const issuer = "https://identity.test",
    url = "https://product.test/admin",
    audience = "https://product.test";
  const keys = await generateKeyPair("RS256");
  const jwk = {
    ...(await exportJWK(keys.publicKey)),
    kid: "test",
    alg: "RS256",
    use: "sig",
  };
  const cookieKey = crypto.getRandomValues(new Uint8Array(32));
  let nonce = "",
    exchanges = 0;
  const codes = new Set<string>();
  const fetch = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init),
        target = new URL(request.url);
      if (target.pathname === "/.well-known/openid-configuration")
        return Response.json({
          issuer,
          authorization_endpoint: issuer + "/authorize",
          token_endpoint: issuer + "/token",
          jwks_uri: issuer + "/jwks",
          response_types_supported: ["code"],
          id_token_signing_alg_values_supported: ["RS256"],
          code_challenge_methods_supported: ["S256"],
        });
      if (target.pathname === "/jwks") return Response.json({ keys: [jwk] });
      if (target.pathname === "/token") {
        exchanges++;
        const body = new URLSearchParams(await request.text());
        expect(body.get("client_secret")).toBe("test-secret");
        expect(body.get("resource")).toBe(audience);
        expect(body.get("code_verifier")?.length).toBeGreaterThan(40);
        const code = body.get("code")!;
        if (codes.has(code))
          return Response.json({ error: "invalid_grant" }, { status: 400 });
        codes.add(code);
        const token = (aud: string, extra: Record<string, unknown>) =>
          new SignJWT(extra)
            .setProtectedHeader({ alg: "RS256", kid: "test" })
            .setIssuer(issuer)
            .setSubject("operator")
            .setAudience(aud)
            .setIssuedAt()
            .setExpirationTime("5m")
            .sign(keys.privateKey);
        return Response.json({
          access_token: await token(audience, {
            scope: "admin:read admin:grants:write",
          }),
          id_token: await token("admin-client", { nonce }),
          token_type: "Bearer",
          expires_in: 300,
        });
      }
      throw new Error("Unexpected OIDC fixture request");
    },
  );
  vi.stubGlobal("fetch", fetch);
  const result = createAdminOidc({
    issuer,
    url,
    audience,
    clientId: "admin-client",
    clientSecret: "test-secret",
    scopes: ["admin:read"],
    cookieKey,
    sessions: new D1AdminSessionStore(sqlite().db),
    verifier: new OidcAuthVerifier(issuer, audience),
  });
  const app = new Hono().route("/admin/session", result.app);
  const start = async () => {
    const response = await app.request(url + "/session/login");
    const location = new URL(response.headers.get("Location")!);
    nonce = location.searchParams.get("nonce")!;
    return {
      response,
      location,
      cookie: response.headers.get("Set-Cookie")!.split(";")[0]!,
    };
  };
  return {
    ...result,
    app,
    start,
    cookieKey,
    getExchanges: () => exchanges,
    setNonce: (v: string) => {
      nonce = v;
    },
    callback: async (state: string, cookie: string, code = "code") =>
      app.request(url + "/session/callback?state=" + state + "&code=" + code, {
        headers: { Cookie: cookie },
      }),
  };
}
describe("admin OIDC BFF", () => {
  // Covers: S_ADMIN_ACCESS case=happy_path
  it("uses state, nonce, PKCE, validated tokens and a revocable HttpOnly opaque session", async () => {
    const f = await fixture();
    const start = await f.start();
    expect(start.location.searchParams.get("code_challenge_method")).toBe(
      "S256",
    );
    expect(start.location.searchParams.get("redirect_uri")).toBe(
      "https://product.test/admin/session/callback",
    );
    expect(start.response.headers.get("Set-Cookie")).toContain("HttpOnly");
    expect(start.response.headers.get("Set-Cookie")).toContain("Secure");
    const response = await f.callback(
      start.location.searchParams.get("state")!,
      start.cookie,
    );
    expect(response.status).toBe(302);
    const cookies = response.headers.getSetCookie();
    const session = cookies.find((c) => c.startsWith("__Host-appbase-admin="))!;
    expect(session).toBeTruthy();
    expect(session).not.toContain("eyJ");
    const request = new Request("https://product.test/admin/context", {
      headers: { Cookie: session.split(";")[0]! },
    });
    expect(await f.authenticate(request)).toEqual({
      sub: "operator",
      scopes: ["admin:read", "admin:grants:write"],
    });
    expect(
      (
        await f.callback(
          start.location.searchParams.get("state")!,
          start.cookie,
        )
      ).status,
    ).toBe(401);
    expect(f.getExchanges()).toBe(1);
    expect(
      (
        await f.app.request("https://product.test/admin/session/logout", {
          method: "POST",
          headers: { Cookie: session, Origin: "https://evil.test" },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await f.app.request("https://product.test/admin/session/logout", {
          method: "POST",
          headers: { Cookie: session, Origin: "https://product.test" },
        })
      ).status,
    ).toBe(302);
    await expect(f.authenticate(request)).rejects.toThrow("expired");
  });
  // Covers: S_ADMIN_ACCESS case=error_path
  it("rejects missing, mismatched and tampered state before token exchange", async () => {
    const f = await fixture();
    const start = await f.start();
    expect((await f.callback("wrong", start.cookie)).status).toBe(401);
    expect(
      (await f.callback(start.location.searchParams.get("state")!, "")).status,
    ).toBe(401);
    expect(
      (
        await f.callback(
          start.location.searchParams.get("state")!,
          start.cookie + "x",
        )
      ).status,
    ).toBe(401);
    expect(f.getExchanges()).toBe(0);
    await expect(
      f.authenticate(new Request("https://product.test/admin")),
    ).rejects.toThrow();
  });
  it("rejects a nonce mismatch and bounds encrypted login attempts to five minutes", async () => {
    const f = await fixture();
    const start = await f.start();
    const { payload } = await jwtDecrypt(
      start.cookie.slice(start.cookie.indexOf("=") + 1),
      f.cookieKey,
      { audience: "https://product.test/admin" },
    );
    expect(payload.exp! - payload.iat!).toBe(300);
    f.setNonce("incorrect");
    expect(
      (
        await f.callback(
          start.location.searchParams.get("state")!,
          start.cookie,
        )
      ).status,
    ).toBe(401);
  });
});
