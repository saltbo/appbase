# Compatibility policy

AppBase uses package semantic versions and a date-based HTTP protocol version.
The first supported protocol version is `2026-08-17`.

## Rules

- Additive optional response properties are backward compatible.
- Existing property meaning, identifier grammar, ordering, merge, cursor, and
  error semantics cannot change within a protocol version.
- New required request properties, removed properties, changed meanings, or
  cursor invalidation require a new protocol version.
- Servers advertise their supported protocol versions and limits through the
  public client-configuration resource.
- Clients send `API-Version` and fail before mutation upload when no supported
  version intersects.
- The legacy Sublyra `/v1/appbase` transport remains supported during migration
  and maps to the same use cases and persisted records.

## Initial package matrix

| Dart packages | Server package | Protocol | Support |
| --- | --- | --- | --- |
| 0.1.x | 0.1.x | 2026-08-17 | Supported |

Before the first stable release, all packages are released together from this
repository. After 1.0, a protocol version remains supported for at least the two
most recent minor client release lines or twelve months, whichever is longer.
