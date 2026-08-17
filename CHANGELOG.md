# Changelog

## 0.1.2 - 2026-08-17

- Emit standards-compliant relative ESM specifiers so the server package loads
  directly in Node and Cloudflare Workers Vitest without consumer bundling.

## 0.1.1 - 2026-08-17

- Build the server package during Git dependency installation so monorepo
  subdirectory consumers receive every declared JavaScript and type export.

## 0.1.0 - 2026-08-17

- Introduce the date-versioned AppBase HTTP protocol and conformance fixtures.
- Add the Cloudflare/Hono/D1 server, OIDC verification, per-user envelope
  encryption, membership primitives, and deployable Worker template.
- Add the pure Dart client and sync engine, transaction-safe Drift persistence,
  and Flutter lifecycle, secure installation identity, and OIDC adapters.
