# Technology decisions

## Optional administration

Keep administration in the existing TypeScript/Hono server package as an
optional subpath export. Native browser controls and small static assets avoid
a new frontend framework. RevenueCat owns complimentary entitlement grants and revocation; administration
only observes membership and configures product quotas, with no local override
engine or payload decryption dependency.

The administration browser is moving to a public OIDC client using authorization
code with PKCE and the existing oauth4webapi library. The browser holds provider
credentials in localStorage as an explicit product choice; application sessions
are not stored in D1. Login attempt state, nonce and the PKCE verifier live in
same-tab sessionStorage and are consumed before code exchange. API handlers
continue to verify the provider access token and apply environment-scoped
permissions independently of browser state.

An origin-scoped Web Lock serializes token refresh and sign-out across tabs.
The old refresh credential is removed before exchange, so a crashed tab or an
uncertain response cannot cause a rotating token to be reused. Refresh failure
requires sign-in. Local sign-out discards product credentials; it does not claim
to end the shared identity-provider session. Browser-persistent credentials are
readable by same-origin JavaScript: the same-origin asset policy and avoidance
of executable untrusted content remain required boundaries.

The existing confidential callback adapter remains available for other hosts
until an explicit compatibility migration retires it. Zigloo's live registration
must change from confidential_web to public_spa, require PKCE and allow the
product origin through CORS at the same release as the browser integration.
Do not expose or transfer the existing client secret into browser configuration.
The unreleased D1 refresh-column migration has been withdrawn.

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

The server package uses esbuild as a development-only tool to bundle the browser
OIDC runtime and oauth4webapi into one same-origin static asset. This avoids a
CDN runtime dependency and preserves the existing framework-free admin UI.

## Benefit execution and policy

Applications declare benefit display metadata, units and the cloud/client
execution boundary alongside their implemented capabilities. This registry is
read-only administration context, not a mutable plan field. Plan limits remain
remote policy for both cloud enforcement and local feature unlocks. Native
membership responses retain their existing contract; administration projects
client-measured usage as null instead of claiming a server-measured zero.
Hosts without a registry retain their existing unspecified benefit presentation.
No ordinal plan comparison or hardcoded paid-plan name is introduced.

## Payment inspection adapters

AdminPaymentProvider supplies provider names, external dashboard navigation,
configuration-presence flags and access classification. RevenueCat-specific
promotional-store classification lives in its adapter, not in admin rendering.
BillingProvider continues to own subscriber synchronization; the admin adapter
does not perform purchases, grant gifts or reimplement provider operations.
A different provider supplies these ports without changing the admin page.
This release configures one active payment provider per environment; it does not
claim to implement simultaneous Stripe/Paddle and RevenueCat settlement.

Webhook inspection reads environment-scoped processing receipts from the
existing event table. Its only historical fields are ID and processed timestamp.
Failed deliveries, payloads, refunds and transaction history are not fabricated
from those receipts. Configuration flags indicate presence, not live health.
