# Optional billing and remote membership catalog

Each product hosts its own database and provider credentials. Billing never
enters the client-writable sync log. RevenueCat is the first optional adapter;
Flutter Paywalls are a separate optional package. Existing sync clients remain
compatible and do not depend on purchases SDKs.

## Acceptance contract 

- Authenticated customers receive an opaque, persistent billing identity.
- SDK account switching cannot publish stale membership or purchase results.
- A purchase/restore triggers authenticated reconciliation; the client cannot
  supply a target identity or assert paid access.
- Verified webhooks reconcile latest provider state, including both sides of a
  transfer. Duplicate notifications are safe and failed work is not acknowledged.
- A provider snapshot commits with a per-account generation and provider timestamp
  check; membership grants are a projection of that single authoritative state. Expiry, refund and grace periods determine effective access.
- Sandbox transactions are excluded from production membership.
- Administrators replace a validated catalog using an ETag precondition.
  Existing capability names/periods and stored plan identities remain stable; new tiers and numeric
  limits and entitlement mappings are configurable. A catalog update takes
  effect on the next authoritative membership read; it needs no app release.
- Store prices remain store-owned; a remotely configured paywall cannot change
  existing subscribers' renewal agreements.

## Install and compose

Server imports: `@saltbo/appbase-server/billing` owns the use cases;
`/revenuecat` exports RevenueCatProvider; `/cloudflare` exports
D1BillingRepository; `/hono` exports createBilling and billingOpenApi.
Apply `migrations/0003_billing.sql` in addition to the existing migrations.
Wrap the existing MembershipRepository in BillingMembershipRepository and supply
MembershipConfig.loadCatalog. The same catalog promise should serve both the
repository and MembershipService within one request. Existing test/admin grants
continue through the wrapped repository; subscription state does not mutate them.

Mount createBilling at `/billing`, outside user-only middleware. Inject the host's
OIDC verifier and authorization policy. Customer operations require appbase:read
or appbase:write in the example host; catalog operations require a distinct
billing:configure permission. Ordinary mobile clients must not receive that scope.
Webhook authorization is a separate high-entropy secret configured on both sides.
Keep RevenueCat secret API keys and webhook secrets in Worker secrets. Public SDK
keys may be returned to authenticated clients. Merge billingOpenApi into the host
OpenAPI and replace example OAuth URLs with the host's discovered identity scheme.

Flutter consumers add appbase_billing; mobile products opt into
appbase_revenuecat. Connect BillingController.setAccount to the existing account
lifecycle. Its opaque SDK identity comes from HttpBillingApi, not email or an
unverified client-supplied subject. The UI adapter uses the current RevenueCat
Offering and presents a remotely configured Paywall, with Customer Center for
subscription management. Native paywall presentation requires iOS 15+ and
Android FlutterFragmentActivity. UI package installation is optional for desktop
products. Do not add a web application target to use this module.

## Remote administration

RevenueCat owns Paywalls, Offerings, targeting and product-to-entitlement mapping.
Apple/Google own prices, subscription periods and existing renewal agreements.
AppBase owns existing plan capability limits, priority (plans array order),
entitlement-to-plan mappings and grace-period policy. New app functionality,
changes to usage accounting periods require code review.
Catalog edits apply on the next authoritative read, not as a push notification.
The membership page reads actual usage and limits. Paywall marketing copy must
be updated in RevenueCat when the matching service benefits change.

The framework ships a management API and an operator client; it does not create
another hosted admin service. With a billing:configure token supplied through
the operator's identity tooling:

```sh
node scripts/billing-catalog.mjs get catalog.json
# Edit the catalog property, retaining etag.
node scripts/billing-catalog.mjs put catalog.json
```

Set APPBASE_URL and APPBASE_ACCESS_TOKEN in the process environment. The file
contains only the catalog and ETag. A stale update returns 412; read again and
reconcile changes. Bootstrap revision 0 is the product's declared default catalog;
a read/storage failure never falls back to defaults. Keep exported revisions if
an operational rollback is needed; reapply an older catalog using the current ETag.

## RevenueCat/store setup and acceptance

1. Create one RevenueCat project per product and connect both store apps.
2. Configure monthly/annual auto-renewable products in the stores; import them,
   attach the shared entitlement, and publish the current Offering and Paywall.
3. Configure Apple In-App Purchase credentials, Google service credentials,
   Apple server notifications and Google RTDN; store notifications go to
   RevenueCat. RevenueCat webhooks go to `/billing/webhooks/revenuecat`.
4. Decide restore/transfer policy explicitly in the RevenueCat dashboard.
   This implementation reconciles both recognized owners in TRANSFER events;
   no anonymous app purchases are exposed. Do not independently assign a
   conflicting appAccountToken or obfuscatedExternalAccountId.
5. Use separate staging deployments/data for sandbox; the membership projection
   accepts exactly one configured environment. Production must use sandbox=false.
   This first adapter supports expiring subscriptions; lifetime purchases are not
   supported. Grace access is controlled by honorGracePeriod; cancellation of
   renewal does not revoke the already-paid period.
6. Exercise TestFlight/Apple sandbox and Play internal testing on actual devices:
   purchase, cancellation, restore, account switch, delayed approval, refund,
   renewal, grace, expiry, transfer, webhook interruption and recovery. Mocked
   SDK tests and builds do not prove store configuration or actual purchases.

Webhook failures are returned for provider redelivery, not acknowledged early.
A successful SDK purchase/restore also invokes reconciliation, so losing the
original callback does not permanently lose membership. SDK errors retain an
explicit failure state. Re-entering the app/refreshing reconciles again. Event
records contain IDs and processed timestamps only; an operator can prune old
processed IDs because repeating reconciliation is idempotent. No scheduled job
or indefinite client retry is installed by the framework.

Server APIs enforce paid expiry even offline clients cannot reach them. Hosts
own offline playback policy. Zigloo retains its existing rule: an unavailable
membership request does not silently become a confirmed Free plan.

## Development and release

The first Zigloo integration uses explicit sibling-checkout path/file dependencies
while these coordinated changes are reviewed. This is a local development bridge,
not a published release. Before packaging either application, release the AppBase
packages/tag and replace those links with the pinned release. Do not publish
absolute local paths or an unresolved future tag.

Dependencies: http is isolated to the billing HTTP client; purchases_flutter and
purchases_ui_flutter are confined to the optional provider package. @types/node
is test tooling for Node SQLite integration of D1 adapter SQL; production runtime
contracts remain Cloudflare types.

## Remotely configured membership tiers

Catalog administration can add paid plan identifiers using the existing free-plan capability schema. Existing plan identifiers and accounting periods must remain so stored grants and usage remain valid. Plans may carry an optional displayName; snapshots add displayName and isPaid. Missing names use the stable plan identifier for compatibility with existing catalogs. Clients should render the returned name and enforce capabilities, never classify paid access from a known plan identifier. Existing clients tolerate the additive response fields; clients that hardcode plan labels require one upgrade before remote tiers display correctly. Retire sale offerings rather than deleting historical plan definitions or entitlement mappings.

## Payment environment pilot

A host may mount ordinary payment paths as `production` and `/sandbox` payment
paths as `sandbox` inside one deployment and database. Construct
`D1BillingRepository(db, environment)` and `D1MembershipRepository(db, environment)`
once at the host composition boundary. The default is production. The five
billing/membership tables use an environment column; sync records, devices,
cursors and encryption keys have no environment changes. Never rewrite the OIDC
subject. Every operation that consumes membership or quota must use the same
bound repositories as the membership page, including product HTTP handlers.
`HttpBillingApi` preserves a base URL path with or without its trailing slash.

Migration `0004_billing_environments.sql` copies existing rows into production,
preserving payment UUIDs, snapshots, generations, events, grants, usage and
catalog revisions. New sandbox rows start empty. `(environment, owner_sub)` owns
a stable random payment UUID. The UUID remains globally unique deliberately:
provider notifications must resolve to one context, even in a shared project.
The other unique keys and all repository predicates include environment.

### Provider identity, restore and notification boundary

Initialize RevenueCat with the server-issued identified UUID before any purchase
or restore. Do not pass the OIDC subject or alias the two environment UUIDs. A
reinstall/login recovers the same UUID from D1; back up this mapping alongside
billing data. Restoring a store receipt may transfer it according to the
RevenueCat project's restore policy; it does not create an AppBase grant from a
client claim. Named-to-named account switches use SDK login, not anonymous
configuration. New sandbox identities do not import the retired test worker's
customers or recreate deleted Test Store products.

For this pilot construct `RevenueCatProvider(key, fetch, environment)`. V1
aggregates entitlements and subscriptions by identifier and product; reusing a
customer across environments can hide one purchase behind another. The adapter
rejects a response containing any opposite-environment subscription, including
mixed histories, before replacing the persisted snapshot. The previous verified
snapshot keeps its original expiry; an error never extends it. This conservative
rejection also requires repair for legacy mixed customers; it is not a receipt
history reconstruction strategy. Keep the argument omitted only for existing
single-context hosts until they adopt this migration.

Mount `createBilling` outside user OIDC middleware. Its shared-secret webhook
authentication is independent. Supply `webhookServices` with both bound services
on both mounts: the requested URL and webhook `environment` string do not grant
access. Resolve known payment IDs from app user/original ID/aliases/transfer
source and destination in each repository, fetch authoritative provider state,
and project only verified matching transactions. Unknown IDs never create an
account. An event is acknowledged only after all contexts succeed; successful
contexts deduplicate on retry, while a failed context remains retryable. Transfer
sources are refreshed to revoke old access as well as recipients to restore it.

Alias/transfer effects inside RevenueCat cannot be undone by a SQL environment
column. Cross-environment aliasing is unsupported. Before live rollout, verify
identified login, reinstall recovery, same-context restore, named-user transfer,
and wrong-context restore with the project's actual policy. If a customer is
already mixed or aliased, stop its test purchases, inspect provider transaction
ownership, and prepare an explicit operator-approved provider repair. Do not
regenerate production UUIDs, merge environment identities, clear snapshots or
extend grants to hide the problem. No provider settings are changed by this PR.

Provider references: [customer response](https://www.revenuecat.com/docs/api-v1/customers),
[identified login and aliases](https://www.revenuecat.com/docs/customers/identifying-customers),
[restore policy](https://www.revenuecat.com/docs/projects/restore-behavior).

### Coordinated rollout (not executed)

1. Review and merge the framework change; publish coordinated server and billing
   client artifacts. Product review can pin the PR commit SHA, not a nonexistent tag.
2. Back up D1 and payment mappings. Check legacy rows, identify mixed provider
   customers, and rehearse the migration on a copy. Plan a maintenance window:
   old binaries using unscoped conflict targets are incompatible with the new schema.
3. Pause affected membership/billing writes, apply the migration once using the
   migration runner, deploy the matching binary, and validate production before
   enabling sandbox clients. Do not run old writers concurrently with migration.
4. Configure and verify the authenticated webhook, then test both contexts,
   revocation, transfer, quota enforcement and unchanged sync. No live execution
   is part of local acceptance.
5. If validation fails, keep writes paused. Prefer a compatible forward fix;
   an old-binary rollback requires restoring the pre-migration database and a
   deliberate reconciliation of any later writes, not an automatic down migration.
