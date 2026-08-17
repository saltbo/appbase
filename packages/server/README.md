# @saltbo/appbase-server

Cloudflare-native server framework for the AppBase local-first synchronization
protocol. It provides runtime-independent synchronization and membership use
cases plus Hono, D1, OIDC, envelope-encryption, and key-rotation adapters.

Use the repository's `templates/cloudflare-worker` project for a deployable
composition. Import Cloudflare adapters from `@saltbo/appbase-server/cloudflare`
and the Hono application factory from `@saltbo/appbase-server/hono`.

The public HTTP contract is versioned independently from the package. See the
repository's `protocol/openapi.yaml`, `protocol/semantics.md`, and
`docs/compatibility.md` before deploying an upgrade.
