# Technology decisions

## Optional administration

Keep administration in the existing TypeScript/Hono server package as an
optional subpath export. Native browser controls and small static assets avoid
a new frontend framework. RevenueCat owns complimentary entitlement grants and revocation; administration
only observes membership and configures product quotas, with no local override
engine or payload decryption dependency.

Use oauth4webapi for standards-based confidential OIDC/PKCE processing rather
than implement token exchange and validation rules manually. Existing JOSE and
OidcAuthVerifier verify identities; opaque short-lived D1 sessions keep OAuth
tokens out of browser code. The callback uses the library's
[authorization code flow](https://github.com/panva/oauth4webapi/tree/main/examples)
and [API validation routines](https://github.com/panva/oauth4webapi/tree/main/docs).

Playwright is a development-only dependency for actual DOM, CSP and responsive
browser acceptance. It is never imported into the Worker or shipped to clients.
The acceptance runner can reuse a system Chromium to avoid redundant downloads.

## D1 administration runtime acceptance

The server development dependencies include Miniflare and Wrangler at the same
versions as the Worker template. Miniflare runs real Workerd D1 SQL and change
metadata in the ordinary server test gate; Wrangler supplies the migration SQL
splitter so trigger bodies are not parsed with a handwritten fixture parser.
Neither package enters the published runtime dependencies. Tests prove that
trigger-counted successful writes and zero-change stale writes stay distinct,
and that the atomic preview query fits the D1 compound SELECT limit.
