# Technology decisions

## Optional administration

Keep administration in the existing TypeScript/Hono server package as an
optional subpath export. Native browser controls and small static assets avoid
a new frontend framework. D1 retains append-only grant identity and conditional
revocation audit; administration has no payload decryption dependency.

Use oauth4webapi for standards-based confidential OIDC/PKCE processing rather
than implement token exchange and validation rules manually. Existing JOSE and
OidcAuthVerifier verify identities; opaque short-lived D1 sessions keep OAuth
tokens out of browser code. The callback uses the library's
[authorization code flow](https://github.com/panva/oauth4webapi/tree/main/examples)
and [API validation routines](https://github.com/panva/oauth4webapi/tree/main/docs).

Playwright is a development-only dependency for actual DOM, CSP and responsive
browser acceptance. It is never imported into the Worker or shipped to clients.
The acceptance runner can reuse a system Chromium to avoid redundant downloads.
