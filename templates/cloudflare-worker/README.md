# AppBase Cloudflare Worker

1. Copy this directory and replace the workspace dependency with the latest
   published `@saltbo/appbase-server` version.
2. Set issuer, public client ID, and audience in `wrangler.jsonc` and the public
   configuration returned by `src/index.ts`.
3. Create D1, replace `database_id`, and keep the included migration.
4. Generate a 32-byte random key, encode it as base64url, and store the keyring
   with `wrangler secret put APPBASE_MASTER_KEYRING`.
5. Run `pnpm types`, `pnpm check`,
   `wrangler d1 migrations apply APPBASE_DB --remote`, then `pnpm deploy`.

Never remove an old master key while any envelope or user key references it.
See `../../docs/key-rotation.md` for the bounded re-encryption and retirement
procedure.
