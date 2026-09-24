-- Deploy the UUID-aware account repository and encryption context resolver before the separate normalize_account_ids.sql data step.
ALTER TABLE appbase_accounts ADD COLUMN previous_id TEXT;
CREATE UNIQUE INDEX appbase_accounts_previous_id ON appbase_accounts(previous_id);
