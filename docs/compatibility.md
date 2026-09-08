# Compatibility policy

AppBase uses package semantic versions and a date-based HTTP protocol version.
The first supported protocol version is `2026-08-17`.

## Rules

- Additive optional response properties are backward compatible.
- Existing property meaning, identifier grammar, ordering, merge, cursor, and
  error semantics cannot change within a protocol version.
- New required request properties, removed properties, changed meanings, or
  cursor invalidation require a new protocol version.
- Servers advertise their supported protocol versions and limits through the
  public client-configuration resource.
- Clients send `API-Version` and fail before mutation upload when no supported
  version intersects.
- The legacy Sublyra `/v1/appbase` transport remains supported during migration
  and maps to the same use cases and persisted records.

## Initial package matrix

| Dart packages | Server package | Protocol   | Support   |
| ------------- | -------------- | ---------- | --------- |
| 0.1.x         | 0.1.3+         | 2026-08-17 | Supported |

Before the first stable release, all packages are released together from this
repository. After 1.0, a protocol version remains supported for at least the two
most recent minor client release lines or twelve months, whichever is longer.

## Optional billing (unreleased)

Billing 0.1.0 adds `/billing/*` independently of sync protocol 2026-08-17.
Existing sync and membership response contracts remain supported. The new
Flutter packages are opt-in and require a host exposing the billing endpoints.
Store prices and paywall configuration remain provider-owned. Administrators
may change existing capability limits, not names or accounting periods.

| Client | Server | Contract |
| --- | --- | --- |
| Existing 0.1.x sync | Billing-enabled server | Unchanged 2026-08-17 |
| appbase_billing 0.1.0 | Billing-enabled server | billing.openapi.json |
| appbase_revenuecat 0.1.0 | appbase_billing 0.1.0 | Mobile Paywall UI |

## Remotely configured membership tiers

Catalog administration can add paid plan identifiers using the existing free-plan capability schema. Existing plan identifiers and accounting periods must remain so stored grants and usage remain valid. Plans may carry an optional displayName; snapshots add displayName and isPaid. Missing names use the stable plan identifier for compatibility with existing catalogs. Clients should render the returned name and enforce capabilities, never classify paid access from a known plan identifier. Existing clients tolerate the additive response fields; clients that hardcode plan labels require one upgrade before remote tiers display correctly. Retire sale offerings rather than deleting historical plan definitions or entitlement mappings.

The payment environment pilot requires migration 0004 and coordinated server rollout. Defaults retain production paths and old membership fields. The billing Dart client now preserves URL prefixes; no sync protocol or cursor version changes. See docs/billing.md for identity, webhook and rollout constraints.

## Administration 0.4.0

Server 0.4.0 removes the 0.3.0 manual-grant API, repository exports and preview
revision fields. Reload the bundled admin UI with the matching server. Apply
0006 after migrating any local manual grants; the migration refuses nonempty
grant storage. Existing legacy membership remains readable. Sync protocol,
cursors and native membership snapshots are unchanged.

| Consumer | Server requirement | Contract |
| --- | --- | --- |
| Bundled administration | 0.4.0, migrations through 0006 | Read membership, configure catalog |
| Existing native billing/sync | 0.4.0 | Existing account/membership contract |
| Billing snapshot consumers | 0.4.0 | Promotional expiresAt may be null |

RevenueCat owns complimentary access. Catalog concurrency still uses a strong
If-Match token; the UI obtains its numeric revision from AppBase-Catalog-Revision
to tolerate proxy weakening of response ETags.

## Server 0.5 administration

The optional admin directory adds a required `list` port for bounded customer
pages. Hosts may use `D1AdminUserDirectory` or implement this method. The single
page helper uses explicit same-origin API URLs; Zigloo moves optional admin API
mounts to `/admin/api` and `/sandbox/admin/api`, keeping one page and OIDC callback.
Legacy page bookmarks redirect to `/admin`. No native customer API, sync protocol,
billing identity, stored data or database migration changes. Previous server
artifacts remain safe to roll back.

## Server 0.7 administration

The bundled administration UI and admin OpenAPI 0.3 are released together.
Administration snapshots use `used: null` for benefits explicitly declared as
client-enforced; native membership snapshots and sync protocol 2026-08-17 are
unchanged. Admin context adds app-owned benefit definitions, provider inspection
metadata and event-inspection availability. Optional inspection ports have
explicit unconfigured states for existing hosts.

Public-browser hosts supply `createAdminPage.oidc` and authenticate API requests
with the identity provider's bearer tokens. Configure a public PKCE registration,
its exact `/admin/callback` redirect and CORS origin with the host release. Tokens
live in origin-scoped browser storage; there is no new session table or migration.
The existing confidential adapter is retained for hosts that have not selected
this flow. Browser bundles are served with the matching API and no-store headers.

Rollback to a confidential host artifact requires restoring its previous identity
provider registration and callback configuration as well as the Worker version.
Do not roll back only the Worker after changing the client's registration type.
Existing payment identities, entitlements, usage and catalog rows are untouched.
New plan identities and mappings persist and remain valid with earlier catalog
readers; never remove customer history merely to undo an admin UI release.

## Schema-owned administration

Admin OpenAPI 0.4 exposes benefitSchema and catalogInitialized; GET catalog is
null with revision 0 before setup. The native membership wire shape is unchanged.
The execution-location field is removed from admin benefit metadata. Schema-mode
validation allows deleting unreferenced non-default plans while preserving existing
entitlement IDs and database-time historical grant references. A default-only
catalog is valid. Existing BillingCatalog constructors retain legacy behavior;
new hosts provide only BillingSchema and initialize through administration.
