# AppBase Agent Instructions

AppBase is a Cloudflare-native, local-first synchronization framework. It ships
one versioned protocol, a TypeScript server package, and Dart/Flutter client
packages.

## Product contract

- Synchronize bounded, private, versioned JSON records for one authenticated
  principal across that principal's devices.
- Keep product schemas and projections on the client. The server owns identity
  isolation, idempotency, revisions, conflicts, cursors, tombstones, encryption
  at rest, and retention mechanics.
- Keep client product writes and outbox writes in one local database
  transaction.
- Deploy one AppBase instance per product. Do not introduce a shared SaaS
  control plane or an application tenant column without an explicit product
  decision.
- Large blobs, server-side record queries, shared collaborative records, and
  end-to-end encryption are outside the core protocol.

## Compatibility

- `protocol/openapi.yaml` and `protocol/semantics.md` are the public contract.
- Every wire change updates protocol fixtures and the compatibility matrix.
- Existing supported clients must continue to synchronize through an explicit
  compatibility path or a documented migration.
- Never invalidate an issued cursor without a tested stale-client recovery
  contract.

## Architecture

- Server domain and application code must not import Hono, Cloudflare, D1,
  JOSE, or runtime configuration.
- The Dart sync engine must not import Flutter, Drift, OIDC, or product code.
- Product collection adapters own payload validation, seeding, projection, and
  account-switch behavior.
- Authentication produces a normalized principal. Authorization is a separate
  injected policy.
- Membership is optional and cannot be mutated through the sync protocol.

## Verification

Run the smallest affected package check while implementing. Before handoff run:

```bash
./scripts/verify.sh
```

The full gate validates protocol artifacts, TypeScript formatting and types,
server tests with coverage, Dart formatting and analysis, Dart tests, the
Cloudflare deployment template, and cross-language conformance fixtures.

Do not publish credentials, tokens, OIDC secrets, wrapping keys, D1 identifiers,
or production URLs.
