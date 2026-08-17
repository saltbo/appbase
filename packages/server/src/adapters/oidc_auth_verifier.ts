import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

import {
  AuthenticationError,
  type AuthVerifier,
  type Principal,
} from "../usecases/ports";

type DiscoveryDocument = {
  issuer: string;
  jwks_uri: string;
};

export class OidcAuthVerifier implements AuthVerifier {
  private jwks: JWTVerifyGetKey | undefined;

  constructor(
    private readonly issuer: string,
    private readonly audience: string,
  ) {}

  async verify(accessToken: string): Promise<Principal> {
    try {
      const { payload } = await jwtVerify(
        accessToken,
        await this.remoteJwks(),
        {
          issuer: this.issuer,
          audience: this.audience,
        },
      );
      if (typeof payload.sub !== "string" || payload.sub.length === 0) {
        throw new AuthenticationError("The access token has no subject claim.");
      }
      return { sub: payload.sub, scopes: tokenScopes(payload) };
    } catch (error) {
      if (error instanceof AuthenticationError) throw error;
      throw new AuthenticationError("The bearer access token is invalid.");
    }
  }

  private async remoteJwks(): Promise<JWTVerifyGetKey> {
    if (this.jwks !== undefined) return this.jwks;
    const discoveryUrl = `${this.issuer.replace(/\/+$/u, "")}/.well-known/openid-configuration`;
    const response = await fetch(discoveryUrl, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok)
      throw new AuthenticationError("OIDC discovery is unavailable.");
    const value: unknown = await response.json();
    if (value === null || typeof value !== "object")
      throw new AuthenticationError("OIDC discovery is invalid.");
    const document = value as Partial<DiscoveryDocument>;
    if (
      document.issuer !== this.issuer ||
      typeof document.jwks_uri !== "string"
    ) {
      throw new AuthenticationError(
        "OIDC discovery does not match the configured issuer.",
      );
    }
    this.jwks = createRemoteJWKSet(new URL(document.jwks_uri));
    return this.jwks;
  }
}

function tokenScopes(payload: Record<string, unknown>): string[] {
  if (typeof payload.scope === "string") {
    return payload.scope.split(/\s+/u).filter((value) => value.length > 0);
  }
  if (Array.isArray(payload.scopes)) {
    return payload.scopes.filter(
      (value): value is string => typeof value === "string",
    );
  }
  return [];
}
