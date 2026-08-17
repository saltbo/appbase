# Operations

## Deploy

Apply D1 migrations before routing traffic to a server that requires them. Run
the Worker dry-run check in CI and use separate Worker names, D1 databases,
OIDC clients, and keyrings for staging and production.

## Observe

Every response includes `Request-Id`; an incoming W3C `traceparent` is echoed.
The server's `observe` hook receives method, path, status, duration, request ID,
and trace context. `reportError` receives only the error and request ID. Log
error classes and stable codes, never bearer tokens, payloads, subjects, or
wrapping material.

Alert on authentication failures, forbidden requests, conflict exhaustion,
5xx rate, D1 errors, p95 latency, outbox age, and clients repeatedly reporting
an unsupported protocol version.

## Recover

Restore D1 into a separate database, validate record counts and decryptability,
then switch the binding in a reviewed deployment. Client outboxes are
idempotent and may replay safely. Never edit issued checkpoints; resetting a
client checkpoint causes a safe full replay into idempotent product adapters.
