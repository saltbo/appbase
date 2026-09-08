CREATE TABLE appbase_admin_grants (
  environment TEXT NOT NULL CHECK(environment IN ('production', 'sandbox')),
  id TEXT NOT NULL,
  owner_sub TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  previous_plan_id TEXT NOT NULL,
  catalog_revision INTEGER NOT NULL,
  revoked_by TEXT,
  revoked_at TEXT,
  revocation_reason TEXT,
  PRIMARY KEY(environment, id),
  CHECK(ends_at > starts_at),
  CHECK((revoked_at IS NULL AND revoked_by IS NULL AND revocation_reason IS NULL)
     OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revocation_reason IS NOT NULL))
);
CREATE INDEX appbase_admin_grants_owner
ON appbase_admin_grants(environment, owner_sub, created_at DESC, id DESC);

CREATE TABLE appbase_admin_sessions (
  id_hash TEXT PRIMARY KEY,
  principal_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX appbase_admin_sessions_expiry ON appbase_admin_sessions(expires_at,id_hash);

CREATE TABLE appbase_admin_login_attempts (
  id_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

CREATE INDEX appbase_admin_login_attempts_expiry ON appbase_admin_login_attempts(expires_at, id_hash);

-- Optimistic concurrency is shared by every writer, including billing and usage.
CREATE TABLE appbase_admin_user_revisions (
  environment TEXT NOT NULL, owner_sub TEXT NOT NULL, revision INTEGER NOT NULL,
  PRIMARY KEY(environment, owner_sub)
);
CREATE TABLE appbase_admin_catalog_revisions (
  environment TEXT PRIMARY KEY, revision INTEGER NOT NULL
);
CREATE TRIGGER appbase_admin_grants_admin_revision_insert AFTER INSERT ON appbase_admin_grants
BEGIN
  INSERT INTO appbase_admin_user_revisions VALUES (NEW.environment,NEW.owner_sub,1) ON CONFLICT(environment,owner_sub) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER appbase_admin_grants_admin_revision_delete AFTER DELETE ON appbase_admin_grants
BEGIN
  INSERT INTO appbase_admin_user_revisions VALUES (OLD.environment,OLD.owner_sub,1) ON CONFLICT(environment,owner_sub) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER appbase_admin_grants_admin_revision_update AFTER UPDATE ON appbase_admin_grants
BEGIN
  INSERT INTO appbase_admin_user_revisions VALUES (OLD.environment,OLD.owner_sub,1) ON CONFLICT(environment,owner_sub) DO UPDATE SET revision=revision+1;
  INSERT INTO appbase_admin_user_revisions VALUES (NEW.environment,NEW.owner_sub,1) ON CONFLICT(environment,owner_sub) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER appbase_membership_grants_admin_revision_insert AFTER INSERT ON appbase_membership_grants
BEGIN
  INSERT INTO appbase_admin_user_revisions VALUES (NEW.environment,NEW.owner_sub,1) ON CONFLICT(environment,owner_sub) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER appbase_membership_grants_admin_revision_delete AFTER DELETE ON appbase_membership_grants
BEGIN
  INSERT INTO appbase_admin_user_revisions VALUES (OLD.environment,OLD.owner_sub,1) ON CONFLICT(environment,owner_sub) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER appbase_membership_grants_admin_revision_update AFTER UPDATE ON appbase_membership_grants
BEGIN
  INSERT INTO appbase_admin_user_revisions VALUES (OLD.environment,OLD.owner_sub,1) ON CONFLICT(environment,owner_sub) DO UPDATE SET revision=revision+1;
  INSERT INTO appbase_admin_user_revisions VALUES (NEW.environment,NEW.owner_sub,1) ON CONFLICT(environment,owner_sub) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER appbase_membership_usage_admin_revision_insert AFTER INSERT ON appbase_membership_usage
BEGIN
  INSERT INTO appbase_admin_user_revisions VALUES (NEW.environment,NEW.owner_sub,1) ON CONFLICT(environment,owner_sub) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER appbase_membership_usage_admin_revision_delete AFTER DELETE ON appbase_membership_usage
BEGIN
  INSERT INTO appbase_admin_user_revisions VALUES (OLD.environment,OLD.owner_sub,1) ON CONFLICT(environment,owner_sub) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER appbase_membership_usage_admin_revision_update AFTER UPDATE ON appbase_membership_usage
BEGIN
  INSERT INTO appbase_admin_user_revisions VALUES (OLD.environment,OLD.owner_sub,1) ON CONFLICT(environment,owner_sub) DO UPDATE SET revision=revision+1;
  INSERT INTO appbase_admin_user_revisions VALUES (NEW.environment,NEW.owner_sub,1) ON CONFLICT(environment,owner_sub) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER appbase_billing_accounts_admin_revision_insert AFTER INSERT ON appbase_billing_accounts
BEGIN
  INSERT INTO appbase_admin_user_revisions VALUES (NEW.environment,NEW.owner_sub,1) ON CONFLICT(environment,owner_sub) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER appbase_billing_accounts_admin_revision_delete AFTER DELETE ON appbase_billing_accounts
BEGIN
  INSERT INTO appbase_admin_user_revisions VALUES (OLD.environment,OLD.owner_sub,1) ON CONFLICT(environment,owner_sub) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER appbase_billing_accounts_admin_revision_update AFTER UPDATE ON appbase_billing_accounts
BEGIN
  INSERT INTO appbase_admin_user_revisions VALUES (OLD.environment,OLD.owner_sub,1) ON CONFLICT(environment,owner_sub) DO UPDATE SET revision=revision+1;
  INSERT INTO appbase_admin_user_revisions VALUES (NEW.environment,NEW.owner_sub,1) ON CONFLICT(environment,owner_sub) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER appbase_billing_catalog_admin_revision_insert AFTER INSERT ON appbase_billing_catalog
BEGIN
  INSERT INTO appbase_admin_catalog_revisions VALUES (NEW.environment,1) ON CONFLICT(environment) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER appbase_billing_catalog_admin_revision_delete AFTER DELETE ON appbase_billing_catalog
BEGIN
  INSERT INTO appbase_admin_catalog_revisions VALUES (OLD.environment,1) ON CONFLICT(environment) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER appbase_billing_catalog_admin_revision_update AFTER UPDATE ON appbase_billing_catalog
BEGIN
  INSERT INTO appbase_admin_catalog_revisions VALUES (OLD.environment,1) ON CONFLICT(environment) DO UPDATE SET revision=revision+1;
  INSERT INTO appbase_admin_catalog_revisions VALUES (NEW.environment,1) ON CONFLICT(environment) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER appbase_records_admin_revision_insert AFTER INSERT ON appbase_records
WHEN NOT EXISTS (SELECT 1 FROM appbase_records WHERE owner_sub=NEW.owner_sub AND sequence<>NEW.sequence)
BEGIN
  INSERT INTO appbase_admin_user_revisions VALUES ('production',NEW.owner_sub,1) ON CONFLICT(environment,owner_sub) DO UPDATE SET revision=revision+1;
  INSERT INTO appbase_admin_user_revisions VALUES ('sandbox',NEW.owner_sub,1) ON CONFLICT(environment,owner_sub) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER appbase_records_admin_revision_delete AFTER DELETE ON appbase_records
WHEN NOT EXISTS (SELECT 1 FROM appbase_records WHERE owner_sub=OLD.owner_sub)
BEGIN
  INSERT INTO appbase_admin_user_revisions VALUES ('production',OLD.owner_sub,1) ON CONFLICT(environment,owner_sub) DO UPDATE SET revision=revision+1;
  INSERT INTO appbase_admin_user_revisions VALUES ('sandbox',OLD.owner_sub,1) ON CONFLICT(environment,owner_sub) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER appbase_records_admin_revision_update AFTER UPDATE ON appbase_records
WHEN OLD.owner_sub<>NEW.owner_sub
BEGIN
  INSERT INTO appbase_admin_user_revisions VALUES ('production',OLD.owner_sub,1) ON CONFLICT(environment,owner_sub) DO UPDATE SET revision=revision+1;
  INSERT INTO appbase_admin_user_revisions VALUES ('sandbox',OLD.owner_sub,1) ON CONFLICT(environment,owner_sub) DO UPDATE SET revision=revision+1;
  INSERT INTO appbase_admin_user_revisions VALUES ('production',NEW.owner_sub,1) ON CONFLICT(environment,owner_sub) DO UPDATE SET revision=revision+1;
  INSERT INTO appbase_admin_user_revisions VALUES ('sandbox',NEW.owner_sub,1) ON CONFLICT(environment,owner_sub) DO UPDATE SET revision=revision+1;
END;
