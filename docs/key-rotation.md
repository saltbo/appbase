# Master-key rotation

`APPBASE_MASTER_KEYRING` is a JSON secret with a positive `currentVersion` and
a base64url-encoded 32-byte AES key for every retained version.

For a non-emergency rotation:

1. Generate a new independent 32-byte key offline.
2. Add it to the keyring and increment `currentVersion`; do not remove old keys.
3. Deploy every writer. New users and newly rotated payloads use the current
   version while old envelopes remain readable.
4. Re-encrypt historical payloads with a controlled administrative migration
   built around `D1EnvelopeSecretCodec`. Pause old writers during that migration.
5. Verify that no stored envelope or user-key row references the previous
   version, export a D1 backup, then remove the previous key in a later deploy.

The core library intentionally does not expose key rotation over public HTTP.
Deleting an old key before verification causes permanent data loss.
