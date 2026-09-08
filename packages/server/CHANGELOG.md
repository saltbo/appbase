# Changelog

## 0.3.0 - Unreleased

- Isolate payment catalogs, identities, snapshots, events, grants and usage by environment with a production-preserving migration.
- Preserve billing client URL prefixes and independently dispatch authenticated webhooks by known payment ownership.
- Add remote paid tiers and editable plan display names using existing capabilities.
- Return additive displayName and isPaid membership fields; preserve existing grants and accounting identities.

## 0.1.3

- Add bounded, resumable payload re-encryption, key-usage inspection, and safe
  retirement of unused per-user keys.
- Consume shared HTTP fixtures in the TypeScript and Dart contract suites.

## 0.1.2

- Emit portable relative ESM specifiers.
