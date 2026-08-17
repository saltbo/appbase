declare namespace Cloudflare {
  interface Env {
    // Secret bindings cannot be inferred from wrangler.jsonc. Set this binding
    // with `wrangler secret put APPBASE_MASTER_KEYRING`.
    APPBASE_MASTER_KEYRING: string;
  }
}

interface Env {
  APPBASE_MASTER_KEYRING: string;
}
