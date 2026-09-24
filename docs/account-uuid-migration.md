# Application account UUID migration

New application accounts use canonical UUID v4 IDs. Payment IDs, sync record IDs,
request IDs, device IDs and credential token formats are unchanged.

## Compatibility boundary

`appbase_accounts.id` and every framework owner reference migrate from `a_` plus
32 hexadecimal characters to the same UUID with hyphens. `previous_id` preserves
the original identifier solely as an immutable client alias and encryption
context. Existing lifecycle clients persist accountId as a local database key:
changing their wire ID would look like a different account and could erase an
unsent outbox. For migrated accounts the server therefore continues returning
that historical accountId on status/session responses. Authentication resolves
the alias to the canonical account before accessing storage. New accounts expose
their UUID directly. Administration reads canonical owner IDs.

The alias stays bound to its original account tombstone after deletion. It must
never be reassigned to a replacement, even with the same identity-provider subject.
Retire wire aliases only after a separately released client can migrate its local
projection, cursor and pending outbox atomically. Do not remove previous_id while
any ciphertext or wrapped key still uses its authenticated encryption context.

Ciphertext, wrapped keys, record sequences, revisions, cursors, mutation IDs,
provider customer IDs and entitlement state are not rewritten. UUID-aware hosts
must configure their envelope codec with the account repository's encryptionOwner:

```ts
const accounts = new D1AccountRepository(db);
const codec = new D1EnvelopeSecretCodec(db, masterKey, 1,
  (id) => accounts.encryptionOwner(id));
```

Hosts without application accounts retain the existing codec default. Custom
AccountCrypto implementations now supply `accountId(): string` returning a UUID;
`random()` remains the credential entropy source and must not be changed.

## Ordered rollout

1. Inventory all prefixed IDs, owner-bearing host tables, constraints, active
   sessions and encrypted key versions. Migration the separate normalize_account_ids.sql data step covers framework tables
   only; host-owned references require corresponding statements in the same batch.
2. Record a provider recovery bookmark/export before schema or data changes.
3. Apply **0009 only**, adding nullable previous_id and its unique index. This
   is compatible with the previous Worker. Do not apply the separate normalize_account_ids.sql data step yet.
4. Deploy the UUID-aware AccountService/repository and configured codec. Verify
   ordinary old-account operations and new UUID registration before data migration.
5. Apply the separate normalize_account_ids.sql data step as one atomic D1 migration/batch. Unexpected a_ formats or UUID
   collisions abort. Deferred foreign keys allow the linked primary-key update.
6. Check no prefixed primary keys/storage owners remain; compare row counts,
   exact ciphertext, sequences, payment IDs/state and identity subject mappings.
   Verify old device renewal, encrypted sync, billing and deletion isolation.

The data step is safe to rerun. The code/schema expansion must precede it. Never
roll back only the Worker after the separate normalize_account_ids.sql data step: the old codec lacks the encryption context
mapping. Prefer roll-forward. A full coordinated database/Worker restore must
account for writes since the bookmark; never discard those writes silently.

Tests in account_uuid.test.ts use actual Workerd D1 and the production encryption,
account and billing adapters. They cover owner migration, ciphertext readability,
new writes, preserved payment identities/cursors, old sessions, cross-user denial,
tombstone isolation, repeat execution and atomic rejection of malformed/colliding IDs.

The data step is deliberately outside the automatic migrations directory. Apply
`maintenance/normalize_account_ids.sql` with `wrangler d1 execute --remote --file`
after the new Worker is verified. Wrangler uses D1's atomic import operation; a
failed import restores the original database. Do not execute individual statements
as separate remote requests.
