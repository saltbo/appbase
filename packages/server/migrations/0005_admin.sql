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
CREATE INDEX appbase_admin_sessions_expiry ON appbase_admin_sessions(expires_at);
