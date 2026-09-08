// Covers: S_ADMIN_SESSION_REFRESH case=contract
import { afterEach, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import * as oauth from "oauth4webapi";
import { AdminBrowserOidc } from "../src/browser/admin_oauth.js";
import { AdminCredentialStore } from "../src/browser/admin_credentials.js";

afterEach(() => vi.unstubAllGlobals());

async function fixture() {
  const issuer = "https://identity.test";
  const resource = "https://product.test";
  const redirectUri = resource + "/admin/callback";
  const keys = await generateKeyPair("RS256");
  const jwk = {
    ...(await exportJWK(keys.publicKey)),
    kid: "key",
    alg: "RS256",
    use: "sig",
  };
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
  let now = Date.now();
  const credentials = new AdminCredentialStore(
    "tokens",
    storage,
    async (_name, run) => run(),
    () => now,
  );
  const flow = new AdminBrowserOidc(
    {
      issuer,
      resource,
      redirectUri,
      clientId: "public-admin",
      scopes: ["admin:production:read"],
    },
    credentials,
    storage,
    () => now,
  );
  let authorization: URL;
  let exchanges = 0;
  let refreshes = 0;
  let invalidNonce = false;
  vi.stubGlobal(
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      if (path === "/.well-known/openid-configuration")
        return Response.json({
          issuer,
          authorization_endpoint: issuer + "/authorize",
          token_endpoint: issuer + "/token",
          jwks_uri: issuer + "/jwks",
          response_types_supported: ["code"],
          id_token_signing_alg_values_supported: ["RS256"],
        });
      if (path === "/jwks") return Response.json({ keys: [jwk] });
      if (path !== "/token") throw new Error("Unexpected request");
      const body = new URLSearchParams(await request.text());
      expect(request.headers.has("Authorization")).toBe(false);
      expect(body.has("client_secret")).toBe(false);
      expect(body.get("client_id")).toBe("public-admin");
      expect(body.get("resource")).toBe(resource);
      if (body.get("grant_type") === "refresh_token") {
        refreshes++;
        expect(body.get("refresh_token")).toBe(
          refreshes === 1 ? "refresh-1" : "refresh-2",
        );
        return Response.json({
          access_token: "renewed-access",
          refresh_token: "refresh-2",
          token_type: "Bearer",
          expires_in: 300,
        });
      }
      exchanges++;
      expect(
        await oauth.calculatePKCECodeChallenge(body.get("code_verifier")!),
      ).toBe(authorization.searchParams.get("code_challenge"));
      expect(body.get("redirect_uri")).toBe(redirectUri);
      const idToken = await new SignJWT({
        nonce: invalidNonce ? "wrong" : authorization.searchParams.get("nonce"),
      })
        .setProtectedHeader({ alg: "RS256", kid: "key" })
        .setIssuer(issuer)
        .setAudience("public-admin")
        .setSubject("operator")
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(keys.privateKey);
      return Response.json({
        access_token: "initial-access",
        refresh_token: "refresh-1",
        id_token: idToken,
        token_type: "Bearer",
        expires_in: 300,
      });
    },
  );
  return {
    flow,
    data,
    exchanges: () => exchanges,
    refreshes: () => refreshes,
    advance: () => {
      now += 300_000;
    },
    invalidNonce: () => {
      invalidNonce = true;
    },
    start: async () => {
      authorization = new URL(await flow.authorizationUrl());
      expect(authorization.searchParams.get("scope")).toContain(
        "offline_access",
      );
      return new URL(
        redirectUri +
          "?code=one&state=" +
          authorization.searchParams.get("state"),
      );
    },
  };
}

it("uses public PKCE, validates the signed identity and replaces rotated refresh credentials", async () => {
  const f = await fixture();
  const callback = await f.start();
  await f.flow.callback(callback);
  expect(await f.flow.accessToken()).toBe("initial-access");
  f.advance();
  expect(await f.flow.accessToken()).toBe("renewed-access");
  f.advance();
  expect(await f.flow.accessToken()).toBe("renewed-access");
  expect(f.refreshes()).toBe(2);
  await expect(f.flow.callback(callback)).rejects.toThrow();
  expect(f.exchanges()).toBe(1);
  await f.flow.signOut();
  expect(f.data.size).toBe(0);
});

it("rejects state mismatch before exchange and nonce mismatch before storing credentials", async () => {
  const f = await fixture();
  const callback = await f.start();
  callback.searchParams.set("state", "wrong");
  await expect(f.flow.callback(callback)).rejects.toThrow();
  expect(f.exchanges()).toBe(0);
  const next = await f.start();
  f.invalidNonce();
  await expect(f.flow.callback(next)).rejects.toThrow();
  expect(f.data.has("tokens")).toBe(false);
});
