# AppBase

AppBase is a Cloudflare-native synchronization framework for local-first Dart
and Flutter applications. Product data stays in a local SQLite database while
bounded versioned JSON records synchronize through an authenticated Worker and
D1.

AppBase deliberately does not mirror a product schema into the cloud. Products
register collection adapters that own local schema, validation, projection, and
conflict metadata. The server remains product-agnostic.

## Packages

- `@saltbo/appbase-server`: runtime-independent sync domain plus Hono,
  Cloudflare D1, OIDC, encryption, and optional membership adapters.
- `appbase_billing`: account-bound purchase orchestration and billing HTTP client.
- `appbase_revenuecat`: optional mobile RevenueCat Paywalls, restore and Customer Center.
- `appbase_client`: pure Dart protocol client and synchronization engine.
- `appbase_drift`: transaction-safe Drift outbox and synchronization metadata.
- `appbase_flutter`: Flutter lifecycle, connectivity, secure installation
  identity, and OIDC integration.

## Guarantees

- authenticated per-principal isolation;
- idempotent device mutations;
- incremental opaque cursors;
- deterministic three-way conflict handling;
- tombstones and stale-client recovery;
- payload encryption at rest with versioned per-user data keys;
- atomic local product write plus outbox enqueue;
- protocol compatibility verified by shared fixtures.

See `docs/architecture.md`, `protocol/semantics.md`, and
`docs/compatibility.md` before integrating a product.

## Development

```bash
pnpm install
dart pub get
./scripts/verify.sh
```

The Cloudflare deployment template lives in `templates/cloudflare-worker`.

## Billing release

The `v0.2.0` Git release includes server package 0.2.0 and the new Flutter billing
packages 0.1.0. Products consuming Git subdirectories should pin every selected
package to `v0.2.0`; override `appbase_billing` to the same Git source when using
`appbase_revenuecat`. Registry publication is separate from this Git release.
See [billing setup and operations](docs/billing.md) for migration, remote catalog,
platform requirements and provider configuration. Existing sync consumers do not
need to enable billing or add native purchase SDKs.
