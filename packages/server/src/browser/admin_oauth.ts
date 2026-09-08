import * as oauth from "oauth4webapi";
import {
  AdminCredentialStore,
  AdminSignInRequired,
  type AdminCredentials,
  type CredentialStorage,
} from "./admin_credentials.js";

export interface AdminBrowserOidcConfiguration {
  issuer: string;
  clientId: string;
  resource: string;
  redirectUri: string;
  scopes: readonly string[];
}

/** Public-client protocol flow; the host never supplies a client secret. */
export class AdminBrowserOidc {
  private readonly client: oauth.Client;
  private metadata: Promise<oauth.AuthorizationServer> | undefined;
  private readonly attemptKey: string;

  constructor(
    private readonly config: AdminBrowserOidcConfiguration,
    private readonly credentials: AdminCredentialStore,
    private readonly attempts: CredentialStorage,
    private readonly now: () => number = Date.now,
  ) {
    this.client = {
      client_id: config.clientId,
      token_endpoint_auth_method: "none",
    };
    this.attemptKey = `appbase.admin.attempt:${config.clientId}:${config.resource}`;
  }

  private options() {
    return {
      signal: AbortSignal.timeout(15_000),
    };
  }

  private server() {
    return (this.metadata ??= oauth
      .discoveryRequest(new URL(this.config.issuer), this.options())
      .then((response) =>
        oauth.processDiscoveryResponse(new URL(this.config.issuer), response),
      ));
  }

  async authorizationUrl(): Promise<string> {
    const as = await this.server();
    if (!as.authorization_endpoint)
      throw new Error("OIDC authorization endpoint is missing.");
    const verifier = oauth.generateRandomCodeVerifier();
    const state = oauth.generateRandomState();
    const nonce = oauth.generateRandomNonce();
    const url = new URL(as.authorization_endpoint);
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      scope: [
        ...new Set(["openid", "offline_access", ...this.config.scopes]),
      ].join(" "),
      resource: this.config.resource,
      code_challenge: await oauth.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256",
      state,
      nonce,
      prompt: "consent",
    }).toString();
    this.attempts.setItem(
      this.attemptKey,
      JSON.stringify({
        verifier,
        state,
        nonce,
        expiresAt: this.now() + 300_000,
      }),
    );
    return url.href;
  }

  async callback(url: URL): Promise<void> {
    const raw = this.attempts.getItem(this.attemptKey);
    this.attempts.removeItem(this.attemptKey);
    if (!raw) throw new AdminSignInRequired();
    const attempt: unknown = JSON.parse(raw);
    if (
      typeof attempt !== "object" ||
      attempt === null ||
      !("verifier" in attempt) ||
      typeof attempt.verifier !== "string" ||
      !("state" in attempt) ||
      typeof attempt.state !== "string" ||
      !("nonce" in attempt) ||
      typeof attempt.nonce !== "string" ||
      !("expiresAt" in attempt) ||
      typeof attempt.expiresAt !== "number" ||
      attempt.expiresAt <= this.now()
    )
      throw new AdminSignInRequired();
    const redirect = new URL(this.config.redirectUri);
    if (url.origin !== redirect.origin || url.pathname !== redirect.pathname)
      throw new AdminSignInRequired();
    const as = await this.server();
    const parameters = oauth.validateAuthResponse(
      as,
      this.client,
      url,
      attempt.state,
    );
    const response = await oauth.authorizationCodeGrantRequest(
      as,
      this.client,
      oauth.None(),
      parameters,
      this.config.redirectUri,
      attempt.verifier,
      {
        ...this.options(),
        additionalParameters: { resource: this.config.resource },
      },
    );
    const result = await oauth.processAuthorizationCodeResponse(
      as,
      this.client,
      response,
      { expectedNonce: attempt.nonce, requireIdToken: true },
    );
    await oauth.validateApplicationLevelSignature(as, response, this.options());
    const subject = oauth.getValidatedIdTokenClaims(result)?.sub;
    if (!subject) throw new AdminSignInRequired();
    await this.credentials.signIn(this.tokenSet(result, subject));
  }

  private tokenSet(
    result: oauth.TokenEndpointResponse,
    subject: string,
    previousRefresh?: string,
  ): AdminCredentials {
    const refreshToken = result.refresh_token ?? previousRefresh;
    if (
      !refreshToken ||
      typeof result.expires_in !== "number" ||
      result.expires_in <= 30
    )
      throw new Error("The provider did not return renewable credentials.");
    return {
      subject,
      accessToken: result.access_token,
      refreshToken,
      expiresAt: this.now() + result.expires_in * 1000,
    };
  }

  async accessToken(): Promise<string> {
    let refreshed = false;
    const accessToken = await this.credentials.accessToken(async (current) => {
      const as = await this.server();
      const response = await oauth.refreshTokenGrantRequest(
        as,
        this.client,
        oauth.None(),
        current.refreshToken,
        {
          ...this.options(),
          additionalParameters: { resource: this.config.resource },
        },
      );
      const result = await oauth.processRefreshTokenResponse(
        as,
        this.client,
        response,
      );
      if (result.id_token)
        await oauth.validateApplicationLevelSignature(
          as,
          response,
          this.options(),
        );
      const subject =
        oauth.getValidatedIdTokenClaims(result)?.sub ?? current.subject;
      const next = this.tokenSet(result, subject, current.refreshToken);
      refreshed = true;
      return next;
    });
    if (refreshed) console.debug("[AppBase admin] token refresh completed");
    return accessToken;
  }

  signOut(): Promise<void> {
    this.attempts.removeItem(this.attemptKey);
    return this.credentials.signOut();
  }
}
