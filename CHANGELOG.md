# Changelog

## 0.1.4 - 2026-08-18

- Add reusable multi-resource OIDC grants for applications that authorize an
  AppBase service and sibling protected APIs in one Realmroot sign-in.

## 0.1.3 - 2026-08-17

- Add executable, bounded D1 key rotation with usage inspection and guarded key
  retirement.
- Make HTTP conformance fixtures executable in both TypeScript and Dart tests.
- Add equal-jitter retry scheduling to the Flutter lifecycle controller.
- Track the Dart workspace lockfile so clean CI runs are reproducible.
- Align unknown-collection semantics with transaction-safe Drift behavior.

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
