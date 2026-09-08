CREATE TABLE appbase_billing_catalog_next (
 environment TEXT NOT NULL DEFAULT 'production' CHECK(environment IN ('production','sandbox')),
 id INTEGER NOT NULL CHECK(id=1), revision INTEGER NOT NULL, catalog_json TEXT NOT NULL,
 PRIMARY KEY(environment,id)
);
INSERT INTO appbase_billing_catalog_next(id,revision,catalog_json) SELECT id,revision,catalog_json FROM appbase_billing_catalog;
DROP TABLE appbase_billing_catalog;
ALTER TABLE appbase_billing_catalog_next RENAME TO appbase_billing_catalog;
CREATE TABLE appbase_billing_accounts_next (
 environment TEXT NOT NULL DEFAULT 'production' CHECK(environment IN ('production','sandbox')),
 owner_sub TEXT NOT NULL, app_user_id TEXT NOT NULL UNIQUE, generation INTEGER NOT NULL DEFAULT 0, state_json TEXT,
 PRIMARY KEY(environment,owner_sub)
);
INSERT INTO appbase_billing_accounts_next(owner_sub,app_user_id,generation,state_json) SELECT owner_sub,app_user_id,generation,state_json FROM appbase_billing_accounts;
DROP TABLE appbase_billing_accounts;
ALTER TABLE appbase_billing_accounts_next RENAME TO appbase_billing_accounts;
CREATE TABLE appbase_billing_events_next (
 environment TEXT NOT NULL DEFAULT 'production' CHECK(environment IN ('production','sandbox')),
 id TEXT NOT NULL, processed_at TEXT NOT NULL, PRIMARY KEY(environment,id)
);
INSERT INTO appbase_billing_events_next(id,processed_at) SELECT id,processed_at FROM appbase_billing_events;
DROP TABLE appbase_billing_events;
ALTER TABLE appbase_billing_events_next RENAME TO appbase_billing_events;
CREATE TABLE appbase_membership_grants_next (
 environment TEXT NOT NULL DEFAULT 'production' CHECK(environment IN ('production','sandbox')),
 id TEXT NOT NULL, owner_sub TEXT NOT NULL, plan_id TEXT NOT NULL, source TEXT NOT NULL,
 starts_at TEXT NOT NULL, ends_at TEXT, created_at TEXT NOT NULL, PRIMARY KEY(environment,id)
);
INSERT INTO appbase_membership_grants_next(id,owner_sub,plan_id,source,starts_at,ends_at,created_at)
 SELECT id,owner_sub,plan_id,source,starts_at,ends_at,created_at FROM appbase_membership_grants;
DROP TABLE appbase_membership_grants;
ALTER TABLE appbase_membership_grants_next RENAME TO appbase_membership_grants;
CREATE INDEX appbase_membership_grants_active ON appbase_membership_grants(environment,owner_sub,starts_at,ends_at);
CREATE TABLE appbase_membership_usage_next (
 environment TEXT NOT NULL DEFAULT 'production' CHECK(environment IN ('production','sandbox')),
 owner_sub TEXT NOT NULL, capability TEXT NOT NULL, period_key TEXT NOT NULL, item_key TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(environment,owner_sub,capability,period_key,item_key)
);
INSERT INTO appbase_membership_usage_next(owner_sub,capability,period_key,item_key,created_at)
 SELECT owner_sub,capability,period_key,item_key,created_at FROM appbase_membership_usage;
DROP TABLE appbase_membership_usage;
ALTER TABLE appbase_membership_usage_next RENAME TO appbase_membership_usage;
CREATE INDEX appbase_membership_usage_count ON appbase_membership_usage(environment,owner_sub,capability,period_key);
