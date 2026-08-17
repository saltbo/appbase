CREATE TABLE IF NOT EXISTS appbase_records (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_sub TEXT NOT NULL,
  collection TEXT NOT NULL,
  record_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  mutation_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  base_revision TEXT,
  payload_json TEXT,
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS appbase_records_owner_mutation
ON appbase_records(owner_sub, device_id, mutation_id);

CREATE UNIQUE INDEX IF NOT EXISTS appbase_records_revision
ON appbase_records(owner_sub, collection, record_id, revision);

CREATE INDEX IF NOT EXISTS appbase_records_current
ON appbase_records(owner_sub, collection, record_id, sequence);

CREATE INDEX IF NOT EXISTS appbase_records_changes
ON appbase_records(owner_sub, sequence);

CREATE TABLE IF NOT EXISTS appbase_user_keys (
  owner_sub TEXT NOT NULL,
  key_version INTEGER NOT NULL,
  wrapped_key TEXT NOT NULL,
  wrap_nonce TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS appbase_user_keys_owner_version
ON appbase_user_keys(owner_sub, key_version);

CREATE TABLE IF NOT EXISTS appbase_membership_grants (
  id TEXT PRIMARY KEY,
  owner_sub TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  source TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS appbase_membership_grants_active
ON appbase_membership_grants(owner_sub, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS appbase_membership_usage (
  owner_sub TEXT NOT NULL,
  capability TEXT NOT NULL,
  period_key TEXT NOT NULL,
  item_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS appbase_membership_usage_unique
ON appbase_membership_usage(owner_sub, capability, period_key, item_key);

CREATE INDEX IF NOT EXISTS appbase_membership_usage_count
ON appbase_membership_usage(owner_sub, capability, period_key);
