-- Keep legacy owner IDs unchanged so ciphertext AAD and issued cursors survive.
CREATE TABLE appbase_accounts (
 id TEXT PRIMARY KEY NOT NULL,
 subject TEXT,
 status TEXT NOT NULL CHECK(status IN ('active','deleting','deleted')),
 legacy INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL,
 deletion_requested_at INTEGER,
 deleted_at INTEGER,
 next_cleanup_at INTEGER,
 cleanup_attempts INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX appbase_accounts_current_identity ON appbase_accounts(subject) WHERE subject IS NOT NULL;
CREATE INDEX appbase_accounts_cleanup ON appbase_accounts(status,next_cleanup_at);
INSERT OR IGNORE INTO appbase_accounts(id,subject,status,legacy,created_at) SELECT DISTINCT owner_sub,owner_sub,'active',1,unixepoch() FROM appbase_records;
INSERT OR IGNORE INTO appbase_accounts(id,subject,status,legacy,created_at) SELECT DISTINCT owner_sub,owner_sub,'active',1,unixepoch() FROM appbase_user_keys;
INSERT OR IGNORE INTO appbase_accounts(id,subject,status,legacy,created_at) SELECT DISTINCT owner_sub,owner_sub,'active',1,unixepoch() FROM appbase_membership_grants;
INSERT OR IGNORE INTO appbase_accounts(id,subject,status,legacy,created_at) SELECT DISTINCT owner_sub,owner_sub,'active',1,unixepoch() FROM appbase_membership_usage;
INSERT OR IGNORE INTO appbase_accounts(id,subject,status,legacy,created_at) SELECT DISTINCT owner_sub,owner_sub,'active',1,unixepoch() FROM appbase_billing_accounts;
INSERT OR IGNORE INTO appbase_accounts(id,subject,status,legacy,created_at) SELECT DISTINCT owner_sub,owner_sub,'active',1,unixepoch() FROM appbase_deleted_accounts;
UPDATE appbase_accounts SET status='deleting',deletion_requested_at=unixepoch(),next_cleanup_at=0
 WHERE id IN (SELECT owner_sub FROM appbase_deleted_accounts);
DROP TRIGGER appbase_records_deleted_account_insert;
DROP TRIGGER appbase_records_deleted_account_update;
DROP TRIGGER appbase_user_keys_deleted_account_insert;
DROP TRIGGER appbase_user_keys_deleted_account_update;
DROP TRIGGER appbase_membership_grants_deleted_account_insert;
DROP TRIGGER appbase_membership_grants_deleted_account_update;
DROP TRIGGER appbase_membership_usage_deleted_account_insert;
DROP TRIGGER appbase_membership_usage_deleted_account_update;
DROP TRIGGER appbase_billing_accounts_deleted_account_insert;
DROP TRIGGER appbase_billing_accounts_deleted_account_update;
INSERT OR IGNORE INTO appbase_billing_accounts(environment,owner_sub,app_user_id)
 SELECT CASE row_number() OVER(PARTITION BY owner_sub ORDER BY app_user_id) WHEN 1 THEN 'production' ELSE 'sandbox' END,
 owner_sub,app_user_id FROM appbase_account_deletion_billing;
-- Fail the transaction instead of silently dropping an unexpected pending customer.
CREATE TABLE appbase_migration_cleanup_guard (missing INTEGER CHECK(missing=0));
INSERT INTO appbase_migration_cleanup_guard
 SELECT count(*) FROM appbase_account_deletion_billing pending
 WHERE NOT EXISTS(SELECT 1 FROM appbase_billing_accounts billing
 WHERE billing.owner_sub=pending.owner_sub AND billing.app_user_id=pending.app_user_id);
DROP TABLE appbase_migration_cleanup_guard;
DROP TABLE appbase_account_deletion_billing;
DROP TABLE appbase_deleted_accounts;
CREATE TABLE appbase_devices (
 token_hash TEXT PRIMARY KEY NOT NULL,
 account_id TEXT NOT NULL REFERENCES appbase_accounts(id),
 device_id TEXT NOT NULL,
 scopes_json TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX appbase_devices_account ON appbase_devices(account_id);
CREATE INDEX appbase_devices_expiry ON appbase_devices(expires_at);
CREATE TRIGGER appbase_records_account_insert BEFORE INSERT ON appbase_records
WHEN EXISTS(SELECT 1 FROM appbase_accounts WHERE id=NEW.owner_sub AND status <> 'active')
BEGIN SELECT RAISE(ABORT,'APPBASE_ACCOUNT_DELETED'); END;
CREATE TRIGGER appbase_records_account_update BEFORE UPDATE ON appbase_records
WHEN EXISTS(SELECT 1 FROM appbase_accounts WHERE id=NEW.owner_sub AND status <> 'active')
BEGIN SELECT RAISE(ABORT,'APPBASE_ACCOUNT_DELETED'); END;
CREATE TRIGGER appbase_user_keys_account_insert BEFORE INSERT ON appbase_user_keys
WHEN EXISTS(SELECT 1 FROM appbase_accounts WHERE id=NEW.owner_sub AND status <> 'active')
BEGIN SELECT RAISE(ABORT,'APPBASE_ACCOUNT_DELETED'); END;
CREATE TRIGGER appbase_user_keys_account_update BEFORE UPDATE ON appbase_user_keys
WHEN EXISTS(SELECT 1 FROM appbase_accounts WHERE id=NEW.owner_sub AND status <> 'active')
BEGIN SELECT RAISE(ABORT,'APPBASE_ACCOUNT_DELETED'); END;
CREATE TRIGGER appbase_membership_grants_account_insert BEFORE INSERT ON appbase_membership_grants
WHEN EXISTS(SELECT 1 FROM appbase_accounts WHERE id=NEW.owner_sub AND status <> 'active')
BEGIN SELECT RAISE(ABORT,'APPBASE_ACCOUNT_DELETED'); END;
CREATE TRIGGER appbase_membership_grants_account_update BEFORE UPDATE ON appbase_membership_grants
WHEN EXISTS(SELECT 1 FROM appbase_accounts WHERE id=NEW.owner_sub AND status <> 'active')
BEGIN SELECT RAISE(ABORT,'APPBASE_ACCOUNT_DELETED'); END;
CREATE TRIGGER appbase_membership_usage_account_insert BEFORE INSERT ON appbase_membership_usage
WHEN EXISTS(SELECT 1 FROM appbase_accounts WHERE id=NEW.owner_sub AND status <> 'active')
BEGIN SELECT RAISE(ABORT,'APPBASE_ACCOUNT_DELETED'); END;
CREATE TRIGGER appbase_membership_usage_account_update BEFORE UPDATE ON appbase_membership_usage
WHEN EXISTS(SELECT 1 FROM appbase_accounts WHERE id=NEW.owner_sub AND status <> 'active')
BEGIN SELECT RAISE(ABORT,'APPBASE_ACCOUNT_DELETED'); END;
CREATE TRIGGER appbase_billing_accounts_account_insert BEFORE INSERT ON appbase_billing_accounts
WHEN EXISTS(SELECT 1 FROM appbase_accounts WHERE id=NEW.owner_sub AND status <> 'active')
BEGIN SELECT RAISE(ABORT,'APPBASE_ACCOUNT_DELETED'); END;
CREATE TRIGGER appbase_billing_accounts_account_update BEFORE UPDATE ON appbase_billing_accounts
WHEN EXISTS(SELECT 1 FROM appbase_accounts WHERE id=NEW.owner_sub AND status <> 'active')
BEGIN SELECT RAISE(ABORT,'APPBASE_ACCOUNT_DELETED'); END;
CREATE TRIGGER appbase_devices_active BEFORE INSERT ON appbase_devices
WHEN NOT EXISTS(SELECT 1 FROM appbase_accounts WHERE id=NEW.account_id AND status='active')
BEGIN SELECT RAISE(ABORT,'APPBASE_ACCOUNT_DELETED'); END;
