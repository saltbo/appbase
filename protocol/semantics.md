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

Unknown collections fail the pull transaction without advancing its checkpoint.
Products must deploy collection adapters before a server begins returning those
collections. This makes an incomplete client rollout visible and prevents silent
loss of product projections.

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

## Remotely configured membership tiers

Catalog administration can add paid plan identifiers using the existing free-plan capability schema. Existing plan identifiers and accounting periods must remain so stored grants and usage remain valid. Plans may carry an optional displayName; snapshots add displayName and isPaid. Missing names use the stable plan identifier for compatibility with existing catalogs. Clients should render the returned name and enforce capabilities, never classify paid access from a known plan identifier. Existing clients tolerate the additive response fields; clients that hardcode plan labels require one upgrade before remote tiers display correctly. Retire sale offerings rather than deleting historical plan definitions or entitlement mappings.

The payment environment pilot requires migration 0004 and coordinated server rollout. Defaults retain production paths and old membership fields. The billing Dart client now preserves URL prefixes; no sync protocol or cursor version changes. See docs/billing.md for identity, webhook and rollout constraints.

## Complimentary membership ownership

RevenueCat owns complimentary entitlement grants, expiration, and revocation.
Administration no longer exposes manual-grants routes or local override state.
Operators use the persisted payment identity in RevenueCat. Native sync and
membership snapshots remain compatible. Billing entitlement expiresAt can be
null only for provider promotional lifetime access. Store transactions retain
strict environment validation; promotions follow the server-owned payment
identity's environment because they have no store sandbox transaction.
Admin catalog responses include AppBase-Catalog-Revision; browser writers build
the strong If-Match value from this explicit revision, independently of proxy
compression changing response ETags.
Existing legacy membership grants remain until explicitly migrated, preserving
previously issued membership.

## Application account lifecycle (2026-09-15)

Hosts enable AccountService with migration 0008 and a scheduled cleanup handler.
One deployment has one configured OIDC issuer; `subject` is scoped to that issuer.
GET account resolves identity without creating data. POST account explicitly creates
an empty account. POST account/sessions exchanges the existing OIDC grant for a
30-minute opaque device token; only its hash is stored. Renewal is pinned to the
original accountId. Business APIs authorize the account's active state on every request.

DELETE account returns 202 after atomically setting deleting and erasing sync history,
keys, grants and usage. Existing billing associations retain cleanup identifiers until
provider deletion succeeds. Scheduled cleanup retries without client participation;
next_cleanup_at and cleanup_attempts track progress. Provider acceptance completes the
application lifecycle; it does not promise synchronous physical deletion by the provider.
The old account becomes deleted and its subject is detached. A subsequent explicit
registration creates a fresh ID and billing customer. Realmroot remains unchanged.

Device tokens lose business access immediately. Their expiring rows allow a lost DELETE
response to be retried against the same old account, never its replacement. Cron removes
expired rows. The deleted account contains no subject or product content for new accounts.
Legacy account IDs retain the original subject to preserve encrypted payload AAD and cursor
compatibility; these minimal legacy fences prevent old clients from resurrecting data.
No new subject-based deletion table or cleanup table is retained.

Clients erase local data and log out after 202. ACCOUNT_DELETED, ACCOUNT_DELETING and
ACCOUNT_SESSION_INVALID also clear the bound local account. New registration clears stale
local projections/outboxes before creating the replacement. Store subscription cancellation
is separate. Migration 0008 cannot safely roll back to a server requiring tables 0007;
recover through a forward fix or coordinated full database/code restore.

Legacy clients may access only migrated active accounts with their original ID. They
cannot register new accounts or address replacements with a bare IdP token. Hosts choosing
the older AccountDeletionService-only route retain its pre-0008 204 contract; hosts with
migration 0008 must configure AccountService and the account-aware verifier together.
