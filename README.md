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
