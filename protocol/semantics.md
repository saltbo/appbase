# AppBase protocol semantics

Protocol version: `2026-08-17`.

## Identity and authorization

Every protected operation is evaluated for one verified OIDC subject. The
subject is never accepted from a path, query, request body, or client-selected
header. A deployment maps product scopes to the framework capabilities
`sync:read`, `sync:write`, and `membership:read`.

## Records

A record is identified by `(principal, collection, recordId)`. Collection and
record identifiers are bounded plaintext index metadata. The payload is a
bounded JSON object encrypted at rest. A delete creates a versioned tombstone;
it does not erase historical versions immediately.

Each accepted mutation appends exactly one immutable record version. A mutation
is identified by `(principal, deviceId, mutationId)`. Replaying that identity
returns the originally accepted change and cannot append another version.

## Conflict handling

`baseRevision` is the revision the client last projected. When it is current,
the client payload is accepted directly. Otherwise the server performs a
three-way whole-record merge using the referenced ancestor, current server
payload, and client payload.

Ordinary properties changed only by the client replace the ancestor value.
When both sides changed the same property, the arriving client value wins.
Products that need an order independent of arrival may include:

```json
{"_sync":{"conflictOrder":["epoch","position"]}}
```

Every named field must be numeric in both candidate payloads. Candidates are
compared lexicographically and the greater complete payload wins. At most eight
fields are allowed. Invalid directives fall back to normal three-way merge.

Deleting a record wins over the current payload when the delete mutation is
accepted. A later stale put is a new conflict and may recreate the record.
Products that forbid recreation must encode a monotonic conflict order or a
product lifecycle rule in their collection adapter.

Concurrent conditional writes are retried against the newest version a bounded
number of times. Exhaustion returns `SYNC_CONFLICT`; the client retains its
outbox mutation and retries later.

## Change traversal

Changes are ordered by the server sequence and traversed with an opaque page
token. A returned `checkpoint` represents every item included in that response.
The client persists it only in the same transaction that applies the page.

An empty page returns the supplied checkpoint or the initial checkpoint. A page
token is scoped to the authenticated principal even though its encoding is not
secret. Clients must not parse, synthesize, compare, or persist a token for a
different account.

Unknown collections are forward-compatible. A client records their revision
metadata and advances its checkpoint without attempting a product projection.

## Client synchronization cycle

One account sync run is non-overlapping:

1. pull and transactionally apply all available pages;
2. load the stable ordered outbox;
3. upload bounded mutation batches and acknowledge only returned mutation ids;
4. pull again until no next page remains.

Transient transport and `5xx` failures retain the outbox and use bounded
exponential backoff with jitter. Validation, authentication, authorization, and
unsupported-version failures stop automatic retry until their cause changes.

## Account switching

Sync metadata is keyed by issuer and subject. A product supplies an account
projection policy that hides or clears the previous account's projected
private records before exposing the next account. Tokens and secure credentials
are never AppBase payload metadata.

## Encryption and key rotation

The Cloudflare adapter creates a random AES-256-GCM data key per principal and
master-key version. The data key is wrapped by that version's deployment master
key. Payload additional authenticated data binds principal, collection,
recordId, and key version.

Deployments rotate by adding a new master key version while retaining every
version referenced by stored envelopes. New payloads use the current version.
Removing an in-use key version is a destructive operation and is not automated.
