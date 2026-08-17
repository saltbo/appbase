# Master-key rotation

`APPBASE_MASTER_KEYRING` is a JSON secret with a positive `currentVersion` and
a base64url-encoded 32-byte AES key for every retained version.

For a non-emergency rotation:

1. Generate a new independent 32-byte key offline.
2. Add it to the keyring and increment `currentVersion`; do not remove old keys.
3. Deploy every writer. New users and newly rotated payloads use the current
   version while old envelopes remain readable.
4. Pause writers still using the previous keyring. From a separately protected
   administrative Worker or script, call `keyUsage()` and repeatedly call
   `reencryptBatch(previousVersion, batchSize)` until `remaining` is zero.
   Batches are ordered, bounded to 1–1000 records, conditionally update the
   original envelope, and are safe to resume after partial failure.
5. Call `retireUserKeys(previousVersion)`. It refuses to delete per-user keys
   while any stored envelope still uses that version. Call `keyUsage()` again,
   export a D1 backup, and only then remove the previous master key in a later
   deploy.

```ts
const codec = new D1EnvelopeSecretCodec(env.APPBASE_DB, keyring);
console.log(await codec.keyUsage());

let batch;
do {
  batch = await codec.reencryptBatch(1, 250);
} while (batch.remaining > 0);

await codec.retireUserKeys(1);
```

The core library intentionally does not expose key rotation over public HTTP.
Deleting an old key before verification causes permanent data loss.
