# Changelog

## 0.7.1 - 2026-09-08

- Show unlimited cloud benefits as not metered instead of presenting historical counters as current usage.

## 0.7.0 - 2026-09-08

- Add public-browser PKCE administration with provider token refresh and cross-tab coordination.
- Separate app-owned cloud benefit semantics and local unlock policy in plan editing and usage inspection.
- Add provider-neutral payment configuration, entitlement status and environment-scoped webhook receipt inspection.
- Support creating plans and adding entitlement mappings through the administration UI.
- Preserve native membership/sync contracts and existing payment data; no database migration is required.


## 0.4.0

- Use RevenueCat promotional entitlements for complimentary membership, including lifetime access and isolated payment identities.
- Remove local manual-grant administration and overrides; preserve legacy membership until explicit migration.
- Retire empty manual-grant storage with a nonempty-data guard.
- Keep catalog editing functional when a proxy weakens response ETags.


## 0.3.0 - Unreleased

- Isolate payment catalogs, identities, snapshots, events, grants and usage by environment with a production-preserving migration.
- Preserve billing client URL prefixes and independently dispatch authenticated webhooks by known payment ownership.
- Add remote paid tiers and editable plan display names using existing capabilities.
- Return additive displayName and isPaid membership fields; preserve existing grants and accounting identities.

## 0.2.0 - 2026-09-07

- Add optional RevenueCat subscription reconciliation, account isolation, authenticated webhooks, and D1 billing persistence.
- Add an operator-managed membership catalog with conditional updates for existing limits and entitlement mappings.
- Add optional Flutter billing and RevenueCat Paywalls/Customer Center packages.
- Preserve the existing synchronization protocol and optional membership integration.
- Require billing migration 0003 only for products enabling billing; store configuration and native acceptance remain product-owned.

## 0.1.4 - 2026-08-18

- Add reusable multi-resource OIDC grants for applications that authorize an
  AppBase service and sibling protected APIs in one Realmroot sign-in.

## 0.1.3 - 2026-08-17

- Add executable, bounded D1 key rotation with usage inspection and guarded key
  retirement.
- Make HTTP conformance fixtures executable in both TypeScript and Dart tests.
- Add equal-jitter retry scheduling to the Flutter lifecycle controller.
- Track the Dart workspace lockfile so clean CI runs are reproducible.
- Align unknown-collection semantics with transaction-safe Drift behavior.

## 0.1.2 - 2026-08-17

- Emit standards-compliant relative ESM specifiers so the server package loads
  directly in Node and Cloudflare Workers Vitest without consumer bundling.

## 0.1.1 - 2026-08-17

- Build the server package during Git dependency installation so monorepo
  subdirectory consumers receive every declared JavaScript and type export.

## 0.1.0 - 2026-08-17

- Introduce the date-versioned AppBase HTTP protocol and conformance fixtures.
- Add the Cloudflare/Hono/D1 server, OIDC verification, per-user envelope
  encryption, membership primitives, and deployable Worker template.
- Add the pure Dart client and sync engine, transaction-safe Drift persistence,
  and Flutter lifecycle, secure installation identity, and OIDC adapters.
