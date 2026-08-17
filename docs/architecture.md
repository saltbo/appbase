# Architecture

## Deployment model

Each product deploys its own AppBase Worker and database. The framework is
multi-user through the authenticated principal but is not a shared multi-product
control plane.

## Dependency direction

```text
Product collection adapters
          |
          v
Pure Dart sync engine -> HTTP protocol <- Hono transport
          |                                  |
          v                                  v
Product SQLite + AppBase outbox       Sync use cases
                                             |
                                             v
                                  D1 + envelope encryption
```

The protocol is the only shared boundary between runtimes. Wire DTO generation
may reduce serialization work, but generated types never own synchronization,
transaction, authorization, or migration behavior.

## Server ownership

The server owns principal isolation, mutation idempotency, revisions, bounded
payloads, deterministic generic merge behavior, ordered change sequences,
tombstones, encryption at rest, retention markers, and stable failure codes.

The server does not know product collection schemas. It cannot query inside
encrypted product payloads and does not decide how a record projects into a
client database.

## Client ownership

The client owns the installation identity, local account state, outbox,
collection registry, initial seed, product projection, local schema migration,
sync scheduling, retry, and UI state.

Product writes and outbox records share one database transaction. Pull pages
advance their cursor only after every recognized projection and sync metadata
row commit successfully. An unknown collection fails the page without advancing
its cursor, making a missing product adapter visible instead of discarding data.

## Security boundary

OIDC authentication terminates at the Worker boundary and produces an immutable
principal. Authorization is injected separately. Payload encryption is server-
side encryption at rest, not end-to-end encryption; the Worker can decrypt a
payload to merge and return it.

Record identifiers and collection names are index metadata and remain
plaintext. Products must use opaque identifiers when their natural identifiers
contain private information.
