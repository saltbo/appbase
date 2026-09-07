CREATE TABLE IF NOT EXISTS appbase_billing_catalog (
  id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL, catalog_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS appbase_billing_accounts (
  owner_sub TEXT PRIMARY KEY, app_user_id TEXT NOT NULL UNIQUE,
  generation INTEGER NOT NULL DEFAULT 0, state_json TEXT
);
CREATE TABLE IF NOT EXISTS appbase_billing_events (
  id TEXT PRIMARY KEY, processed_at TEXT NOT NULL
);
