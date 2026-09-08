# Optional product administration

Each product may mount the `@saltbo/appbase-server/admin` module in its own
Worker. It is not a shared control plane. Unmounted products have no admin
routes, UI, session cookies, or administration dependency in their client.

## Inventory and first release

| Existing storage | Operational use | Boundary |
| --- | --- | --- |
| billing_accounts | Exact subject/payment identity lookup and subscription snapshot | Read only; lookup never creates an identity |
| billing_catalog | Plan names, limits, entitlement mapping and grace policy | Existing validation and ETag concurrency rules |
| membership_grants | Existing membership fallback | Never rewritten by administration |
| membership_usage | Aggregate capability usage through MembershipService | No usage item identifiers exposed |
| billing_events | Provider notification deduplication | No event management in this release |
| records | Recognize a subject already known to sync | Only owner_sub, never record identifiers or payloads |
| user_keys | Payload encryption keys | No administration access |

AppBase does not own an email/name directory. The first release therefore uses
exact subjects or opaque payment identities, rather than pretending to search
Realmroot users by email. Unknown users are rejected, not provisioned by a grant.
Private collections, WebDAV credentials, tokens, encryption keys, payment
management URLs and arbitrary SQL are never exposed. Grant reasons are operator
text; do not include secrets or unnecessary personal data.

The stack remains TypeScript, Hono and D1. The UI is a small same-origin HTML/JS
module with native controls; no separate application framework or build pipeline.
The product supplies its name, catalog, authorization policy and OIDC registration.
UI uses remote displayName where present, otherwise the stable plan id.

## Manual grant semantics

Apply `0005_admin.sql` after the billing environment migration. Manual grants
live in `appbase_admin_grants`, not the existing grant or RevenueCat tables.
They record environment, UUID, subject, plan, start/end, reason, operator,
creation time, previous plan and reviewed catalog revision. Revocation adds
operator, reason and time through a conditional update. Neither operation
deletes history or mutates a subscription, transaction or provider event.

Compose repositories in this order (outermost first):

```
AdminMembershipRepository
  BillingMembershipRepository
    D1MembershipRepository
```

An active manual grant **overrides** the entire underlying plan, even if it
reduces paid benefits. It is not an additive allowance. The confirmation page
shows the current membership and proposed limits and requires the operator to
type the environment. The server checks the supplied membership snapshot and
catalog revision again before creation. These are fresh-read checks, not a
distributed lock against concurrent purchases or other operators; later valid
changes still take effect normally.

Among active manual grants, latest created_at wins, then greatest id for a
stable tie break. Starts are inclusive, ends exclusive. Expired/revoked grants
are ignored; the next active manual grant applies, then the original billing
and membership chain, then the product's default plan. Revoke every active
override if the intention is to return immediately to subscription behavior.
The UI refreshes after every successful write. Reusing an id or revoking twice
returns 409 so uncertain outcomes can be inspected without rewriting audit.
History uses a bounded 50-row page and stable grant cursor.

## Environment and compatibility

Mount production at `/admin` and sandbox at `/sandbox/admin`. Both the service
and D1AdminRepository are constructed with one immutable environment. The
request body/header is only a confirmation; it never selects storage.
Environment links must be same-origin, and authorization receives the selected
environment on every operation. Give production and sandbox permissions
independently when the product requires different operator access.

This module depends on the separately reviewed billing environment migration
and repositories. Do not enable both environments on the old unscoped billing
schema. `D1AdminUserDirectory` deliberately requires the real environment
columns; there is no detection/fallback path. Sync data remains shared as the
pilot specifies. The manual grant table is isolated regardless of the host's
other repositories, but the host must also use the matching environment for
subscription reads, membership queries and quota enforcement.

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

The encrypted login attempt is bound to the mount, browser cookie, nonce and
state for five minutes. Successful login rotates the opaque session. Only the
session id hash, normalized principal/scopes and expiry live in D1. Sessions
last at most five minutes and never outlive the token response/ID token expiry;
there is no refresh token. Permission changes take effect on reauthentication
or expiry within that window. Logout deletes the server session and cookie; it
does not log the operator out of Realmroot or sibling applications. Expired
session rows can be removed by the host's retention job with
`DELETE FROM appbase_admin_sessions WHERE expires_at <= ?` (epoch milliseconds).

All admin operations require an explicit injected authorization policy.
Every read requires `admin:read`; grants additionally require
`admin:grants:write`; catalog writes additionally require `billing:configure`.
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
payment services are contacted. It covers empty/error states, preview, wrong
environment rejection, grant/revoke refresh, quota editing and narrow layout.

Before deployment, the host must separately accept its actual Realmroot login,
permission grants, environment composition and Worker/D1 runtime. Publishing,
live grant writes and deployment are outside this implementation task.
