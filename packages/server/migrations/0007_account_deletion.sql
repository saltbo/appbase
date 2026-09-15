-- Minimal revocation fence, not an account profile. Never automatically recreate it.
CREATE TABLE appbase_deleted_accounts (owner_sub TEXT PRIMARY KEY);
CREATE TABLE appbase_account_deletion_billing (
  owner_sub TEXT NOT NULL, app_user_id TEXT NOT NULL, PRIMARY KEY(owner_sub, app_user_id)
);
CREATE TRIGGER appbase_records_deleted_account_insert BEFORE INSERT ON appbase_records
WHEN EXISTS (SELECT 1 FROM appbase_deleted_accounts WHERE owner_sub = NEW.owner_sub)
BEGIN SELECT RAISE(ABORT, 'APPBASE_ACCOUNT_DELETED'); END;
CREATE TRIGGER appbase_records_deleted_account_update BEFORE UPDATE ON appbase_records
WHEN EXISTS (SELECT 1 FROM appbase_deleted_accounts WHERE owner_sub = NEW.owner_sub)
BEGIN SELECT RAISE(ABORT, 'APPBASE_ACCOUNT_DELETED'); END;
CREATE TRIGGER appbase_user_keys_deleted_account_insert BEFORE INSERT ON appbase_user_keys
WHEN EXISTS (SELECT 1 FROM appbase_deleted_accounts WHERE owner_sub = NEW.owner_sub)
BEGIN SELECT RAISE(ABORT, 'APPBASE_ACCOUNT_DELETED'); END;
CREATE TRIGGER appbase_user_keys_deleted_account_update BEFORE UPDATE ON appbase_user_keys
WHEN EXISTS (SELECT 1 FROM appbase_deleted_accounts WHERE owner_sub = NEW.owner_sub)
BEGIN SELECT RAISE(ABORT, 'APPBASE_ACCOUNT_DELETED'); END;
CREATE TRIGGER appbase_membership_grants_deleted_account_insert BEFORE INSERT ON appbase_membership_grants
WHEN EXISTS (SELECT 1 FROM appbase_deleted_accounts WHERE owner_sub = NEW.owner_sub)
BEGIN SELECT RAISE(ABORT, 'APPBASE_ACCOUNT_DELETED'); END;
CREATE TRIGGER appbase_membership_grants_deleted_account_update BEFORE UPDATE ON appbase_membership_grants
WHEN EXISTS (SELECT 1 FROM appbase_deleted_accounts WHERE owner_sub = NEW.owner_sub)
BEGIN SELECT RAISE(ABORT, 'APPBASE_ACCOUNT_DELETED'); END;
CREATE TRIGGER appbase_membership_usage_deleted_account_insert BEFORE INSERT ON appbase_membership_usage
WHEN EXISTS (SELECT 1 FROM appbase_deleted_accounts WHERE owner_sub = NEW.owner_sub)
BEGIN SELECT RAISE(ABORT, 'APPBASE_ACCOUNT_DELETED'); END;
CREATE TRIGGER appbase_membership_usage_deleted_account_update BEFORE UPDATE ON appbase_membership_usage
WHEN EXISTS (SELECT 1 FROM appbase_deleted_accounts WHERE owner_sub = NEW.owner_sub)
BEGIN SELECT RAISE(ABORT, 'APPBASE_ACCOUNT_DELETED'); END;
CREATE TRIGGER appbase_billing_accounts_deleted_account_insert BEFORE INSERT ON appbase_billing_accounts
WHEN EXISTS (SELECT 1 FROM appbase_deleted_accounts WHERE owner_sub = NEW.owner_sub)
BEGIN SELECT RAISE(ABORT, 'APPBASE_ACCOUNT_DELETED'); END;
CREATE TRIGGER appbase_billing_accounts_deleted_account_update BEFORE UPDATE ON appbase_billing_accounts
WHEN EXISTS (SELECT 1 FROM appbase_deleted_accounts WHERE owner_sub = NEW.owner_sub)
BEGIN SELECT RAISE(ABORT, 'APPBASE_ACCOUNT_DELETED'); END;
