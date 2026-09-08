# Administration

New hosts supply a `BillingSchema`, not initial plan data. Each capability declares
`type: "quota"`, display name, description, unit and accounting period. Quota values
are nonnegative integers or unlimited; this release does not add boolean or enum
benefit encodings to the native membership protocol. There is no execution-location
field. Consumers decide where to use or enforce a returned value.

`createD1AdminServices(db, environment, provider, schema)` supplies schema metadata
to the admin UI. An empty environment shows setup. The operator supplies the default
plan identity and explicit limits; saving atomically persists revision 1. Runtime
membership and billing access fail with CONFIGURATION_MISSING until configured.
The default plan can be the only plan. Additional plans, benefit values, bindings
and priority are administered without deployment.

Deleting an unbound non-default plan uses the catalog revision and a database-time
historical-grant reference check. Existing entitlement mappings must be retained
or reassigned; referenced/default plans cannot be deleted. Deleting store products
or canceling subscriptions remains provider-owned.

The legacy BillingCatalog constructor remains compatible with existing released
hosts. New integrations use BillingSchema. Migrating an existing host must persist
its currently effective policies before switching to schema-only configuration;
never overwrite an environment that already has a stored catalog.

# Optional product administration

Each product may mount the `@saltbo/appbase-server/admin` module in its own
Worker. It is not a shared control plane. Unmounted products have no admin
routes, UI, session cookies, or administration dependency in their client.

## Inventory and first release

| Existing storage | Operational use | Boundary |
| --- | --- | --- |
| billing_accounts | Paginated searchable payment customers and subscription details | Read only; lookup never creates an identity |
| billing_catalog | Plan names, limits, entitlement mapping and grace policy | Existing validation and ETag concurrency rules |
| membership_grants | Existing membership fallback | Never rewritten by administration |
| membership_usage | Aggregate capability usage through MembershipService | No usage item identifiers exposed |
| billing_events | Provider notification deduplication | No event management in this release |
| records | Recognize a subject already known to sync | Only owner_sub, never record identifiers or payloads |
| user_keys | Payload encryption keys | No administration access |

AppBase does not own an email/name directory. The first release therefore uses
subjects or opaque payment identities. It does not search Realmroot users by email.
`GET /customers` lists only existing billing accounts, including accounts without
a synchronized subscription. Search is a literal substring of either ID; pages
are ordered by the unique subject, default to 20 rows and are capped at 50.
Count and rows use a single two-statement D1 batch. The list projects plan names
and synchronization time without fetching every customer’s quota usage.
Details retain exact lookup, including existing sync-only subjects. Reads never create users.
Private collections, WebDAV credentials, tokens, encryption keys, payment
management URLs and arbitrary SQL are never exposed.

The stack remains TypeScript, Hono and D1. The UI is a small same-origin HTML/JS
module with native controls; no separate application framework or build pipeline.
The product supplies its name, bootstrap catalog, authorization policy and OIDC registration.
The bootstrap catalog is used only before an environment has a stored catalog;
administrator changes persist in D1 and take precedence over bootstrap values.
UI uses remote displayName where present, otherwise the stable plan id.
The Plans page lists configured free and paid plans before any form is opened.
Read-only operators can inspect entitlement bindings and plan selection priority.
Creation copies a template and lets operators set limits and bind an existing
provider entitlement in the same atomic catalog update. Editing a plan includes
its limits, priority, existing bindings and additional entitlement bindings.
Duplicate bindings are rejected; existing entitlement IDs are retained for
historical purchases. Reassigning a binding affects its existing holders.
Grace period policy is viewed and edited under Payment settings. Provider secrets
remain deployment configuration; prices, products and gifts remain provider-owned.
Environment switching discards the old editor and loads the selected environment.
Catalog writes retain ETag conflict protection and preserve unrelated fields.

## Complimentary access in RevenueCat

Open the customer in RevenueCat using the payment identity displayed here, then
grant or revoke its entitlement there. RevenueCat owns its expiry and history;
AppBase synchronizes the provider snapshot and maps entitlement IDs to product
plans. Promotions do not cancel store subscriptions and do not auto-renew.

AppBase has no manual grant API, override repository, or grant-writing scope.
Apply 0006_revenuecat_grants.sql after 0005. Retirement refuses to proceed if
any old manual grant rows exist: preserve and explicitly migrate those first.
Legacy membership_grants rows are retained as a compatibility source; they are
not editable in this administration module.

## Environment and compatibility

Mount one `createAdminPage` at `/admin`, one OIDC flow at `/admin/session`,
and `createAdmin` with `serveUi: false` at `/admin/api` and `/sandbox/admin/api`.
The page's environment selector changes only its API base; it does not navigate
or persist the choice in the URL. Old `/sandbox/admin` bookmarks may redirect
to `/admin`. APIs and billing repositories have immutable environments; the
request header confirms a write and never selects storage. Every API operation
independently authorizes access to its environment. Page assets contain no user
data and may be served before login. Switching aborts old reads and discards
stale responses. Catalog forms capture their API environment and revision;
in-flight writes can only reach that original environment.

This module depends on the separately reviewed billing environment migration
and repositories. Do not enable both environments on the old unscoped billing
schema. `D1AdminUserDirectory` deliberately requires the real environment
columns; there is no detection/fallback path. Sync data remains shared as the
pilot specifies. The host uses matching environments for provider reads, membership and quotas.
Promotions have no store sandbox; they inherit the environment of the distinct
server-owned payment UUID. Ordinary store transactions still require the matching
verified sandbox flag.

The optional admin API is documented by `protocol/admin.openapi.json` and
exported as `adminOpenApi`. It does not change sync routes, cursors or existing
membership representations. Prefix its paths when merging into a host OpenAPI.

## OIDC BFF and authorization

`createAdminOidc` provides a confidential server-owned OIDC authorization-code
flow using oauth4webapi. It discovers issuer endpoints, uses state/nonce/PKCE,
validates ID token signatures and validates the API access token through the
host's AuthVerifier. The token subject must agree with the ID token subject.
No access or refresh token is sent to JavaScript or retained in the database.

Register a confidential Realmroot web client with exact HTTPS callbacks, e.g.
`https://product.example/admin/session/callback` and, if independently mounted,
`https://product.example/sandbox/admin/session/callback`. This code uses
client_secret_post. Store its client secret and a random 32-byte login-cookie
encryption key as Worker secrets. No online registration is performed by this PR.
Request only the product's registered administration scopes and audience.

Login attempts are consumed atomically before code exchange, preventing callback replay.
The encrypted login attempt is bound to the mount, browser cookie, nonce and
state for five minutes. Successful login rotates the opaque session. Only the
session id hash, normalized principal/scopes and expiry live in D1. Sessions
last at most five minutes and never outlive the token response/ID token expiry;
there is no refresh token. Permission changes take effect on reauthentication
or expiry within that window. Logout deletes the server session and cookie; it
does not log the operator out of Realmroot or sibling applications. Expired
session and login-attempt rows are automatically pruned on creation, lookup and
consumption: each operation deletes at most 100 expired rows from each table,
oldest first through `(expires_at,id_hash)` indexes. Active rows are untouched;
expiry is inclusive. Continued activity drains old backlogs while each call's
work stays bounded. Hosts can additionally call `D1AdminSessionStore.pruneExpired`
from their retention schedule to drain idle deployments. This is not a rate
limit on unexpired login attempts; the host's normal ingress policy still applies.

All admin operations require an explicit injected authorization policy.
Every read requires `admin:read`; catalog writes additionally require `billing:configure`.
These are capability names mapped by the host to its actual granted scopes.
Ordinary mobile `appbase:read`/`appbase:write` authority must not map to them.
Hidden buttons never supply authorization. Cookie writes require an exact Origin
match; the mount uses no-store, restrictive CSP, no framing and no referrer.
The UI accepts no pasted bearer token. A host with an existing verified BFF may
inject its session authenticator instead of mounting createAdminOidc.

The cookie namespace is host-wide, appropriate to one product per host. Use
the same operator issuer/audience for both environment mounts and distinguish
environment authority in the injected policy. The product controls registry
configuration and actual permission grants; this library cannot grant them.

## Host composition

Use `createD1AdminServices` once per request with the selected environment. It
constructs all billing, usage and legacy repositories together. Route
the returned `membership` service into customer membership reads and every
quota-enforced operation. Existing specialized hosts may instead compose the
documented repository chain themselves.

```ts
import { Hono } from "hono";
import {
  createAdmin, createAdminPage, createAdminOidc, createD1AdminServices, D1AdminSessionStore,
} from "@saltbo/appbase-server/admin";
import { OidcAuthVerifier } from "@saltbo/appbase-server/cloudflare";

// env, baseline and provider come from the product's composition root.
const worker = new Hono();
const operatorPolicy = (principal, capability, environment) =>
  principal.scopes.includes(`operations:${environment}:${capability}`);
const environments = [
  { name: "production", url: env.PUBLIC_ORIGIN + "/admin/api" },
  { name: "sandbox", url: env.PUBLIC_ORIGIN + "/sandbox/admin/api" },
] as const;
const oidc = createAdminOidc({
  issuer: env.OIDC_ISSUER, audience: env.ADMIN_AUDIENCE,
  clientId: env.ADMIN_CLIENT_ID, clientSecret: env.ADMIN_CLIENT_SECRET,
  url: env.PUBLIC_ORIGIN + "/admin", cookieKey: decodeCookieKey(env.ADMIN_COOKIE_KEY),
  scopes: productRegisteredOperatorScopes,
  sessions: new D1AdminSessionStore(env.DB),
  verifier: new OidcAuthVerifier(env.OIDC_ISSUER, env.ADMIN_AUDIENCE),
});
worker.route("/admin/session", oidc.app);
worker.route("/admin", createAdminPage({
  url: env.PUBLIC_ORIGIN + "/admin", productName: env.PRODUCT_NAME, environments,
}));
for (const { name: environment, url } of environments) {
  worker.route(new URL(url).pathname, createAdmin({
    environment, url, serveUi: false, productName: env.PRODUCT_NAME, environments,
    authenticate: oidc.authenticate, authorize: operatorPolicy,
    service: () => createD1AdminServices(env.DB, environment, provider(environment), baseline).admin,
  }));
}
```

The scope names above illustrate a product policy, not pre-registered Realmroot
permissions. Register and map the actual scopes before enabling the module.
`decodeCookieKey` is the host's secret decoder and must produce 32 bytes. Do not
put cookie or confidential client secrets in public configuration.

## Verification

Run `pnpm --filter @saltbo/appbase-server exec vitest run test/admin.test.ts
test/admin_oidc.test.ts` for SQLite, HTTP, membership composition and a signed
fixture OIDC issuer. These tests do not claim a real Realmroot deployment login.

After `pnpm build`, run
`node packages/server/test/browser/admin.mjs` for real Chromium UI acceptance.
Install the matching Playwright Chromium once or set `APPBASE_CHROME_PATH` to an
existing Chrome executable. `APPBASE_ADMIN_SCREENSHOT` optionally saves a local
fixture screenshot. The script intercepts only its fixture origin and sends
requests to the actual Hono router and SQLite adapters; no live memberships or
payment services are contacted. It covers empty/error states, provider-only membership, quota editing with
proxy-weakened ETags and narrow layout.

Before deployment, the host must separately accept its actual Realmroot login,
permission grants, environment composition and Worker/D1 runtime. Publishing,
live grant writes and deployment are outside this implementation task.

The host sets `tokenEndpointAuthMethod` to the confidential client's actual
registration: `client_secret_basic` sends HTTP Basic authentication;
`client_secret_post` sends form credentials (the compatibility default).
Zigloo explicitly uses `client_secret_basic`. The adapter does not guess or
retry with another authentication method after an exchange failure.

D1 runtime acceptance verifies successful and rejected conditional billing writes,
quota enforcement, and isolated provider membership with the retired tables absent.
