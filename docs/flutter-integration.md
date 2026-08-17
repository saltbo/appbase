# Flutter product integration

An application owns its Drift database and collection adapters. AppBase owns
only account, record, and outbox metadata inside that same database.

1. Add `appbase_client`, `appbase_drift`, and `appbase_flutter`.
2. Create the AppBase tables in the application's Drift migration. Never open a
   separate AppBase database: a product write and its outbox mutation must share
   one transaction.
3. Implement one `AppBaseCollectionAdapter` per collection. Validate every
   remote payload before modifying the product projection. `apply`, `seed`, and
   `deactivate` execute inside the database transaction and must not perform
   network calls or irreversible external side effects.
4. Configure `AppBaseOidcPolicy` with the product's redirect URIs, namespace,
   and any product scopes in addition to `appbase:read` and `appbase:write`.
5. Build `AppBaseHttpApi`, `AppBaseOidcSession`, `AppBaseDriftPersistence`,
   `AppBaseSyncEngine`, and the Flutter `AppBaseSyncController` in that order.
6. Pass connectivity and application-resume events as retry signals. Permanent
   authentication, authorization, validation, and protocol failures remain
   visible until product or user action resolves them.

Account switching calls every adapter's `deactivate` method before activating
the new account. Products decide whether that means clearing, partitioning, or
locking the old projection. The next pull starts from an empty checkpoint.

Use opaque record identifiers. The server encrypts payloads, but collection and
record identifiers remain index metadata. Large media and attachments belong in
object storage and should be referenced by opaque handles.
