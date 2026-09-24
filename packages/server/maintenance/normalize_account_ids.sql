-- Requires the UUID-aware Worker. Run as one atomic D1 batch/migration.
-- Preserve previous_id for issued client bindings and encrypted AAD, not as an owner.
PRAGMA defer_foreign_keys = ON;
CREATE TABLE appbase_account_uuid_map (
 old_id TEXT PRIMARY KEY, new_id TEXT NOT NULL UNIQUE
);
-- Abort on unexpected prefixed IDs instead of silently producing malformed UUIDs.
CREATE TABLE appbase_account_uuid_guard (invalid INTEGER CHECK(invalid=0));
INSERT INTO appbase_account_uuid_guard
 SELECT count(*) FROM appbase_accounts WHERE substr(id,1,2)='a_' AND
 (length(id)<>34 OR substr(id,3) GLOB '*[^0-9a-f]*' OR substr(id,15,1)<>'4'
 OR substr(id,19,1) NOT IN ('8','9','a','b') OR previous_id IS NOT NULL);
INSERT INTO appbase_account_uuid_map
 SELECT id, substr(id,3,8)||'-'||substr(id,11,4)||'-'||substr(id,15,4)||'-'||substr(id,19,4)||'-'||substr(id,23,12)
 FROM appbase_accounts WHERE substr(id,1,2)='a_';
INSERT INTO appbase_account_uuid_guard
 SELECT count(*) FROM appbase_account_uuid_map m JOIN appbase_accounts a ON a.id=m.new_id;
UPDATE appbase_records SET owner_sub=(SELECT new_id FROM appbase_account_uuid_map WHERE old_id=appbase_records.owner_sub)
 WHERE owner_sub IN (SELECT old_id FROM appbase_account_uuid_map);
UPDATE appbase_user_keys SET owner_sub=(SELECT new_id FROM appbase_account_uuid_map WHERE old_id=appbase_user_keys.owner_sub)
 WHERE owner_sub IN (SELECT old_id FROM appbase_account_uuid_map);
UPDATE appbase_membership_grants SET owner_sub=(SELECT new_id FROM appbase_account_uuid_map WHERE old_id=appbase_membership_grants.owner_sub)
 WHERE owner_sub IN (SELECT old_id FROM appbase_account_uuid_map);
UPDATE appbase_membership_usage SET owner_sub=(SELECT new_id FROM appbase_account_uuid_map WHERE old_id=appbase_membership_usage.owner_sub)
 WHERE owner_sub IN (SELECT old_id FROM appbase_account_uuid_map);
UPDATE appbase_billing_accounts SET owner_sub=(SELECT new_id FROM appbase_account_uuid_map WHERE old_id=appbase_billing_accounts.owner_sub)
 WHERE owner_sub IN (SELECT old_id FROM appbase_account_uuid_map);
UPDATE appbase_devices SET account_id=(SELECT new_id FROM appbase_account_uuid_map WHERE old_id=appbase_devices.account_id)
 WHERE account_id IN (SELECT old_id FROM appbase_account_uuid_map);
UPDATE appbase_accounts SET previous_id=id, id=(SELECT new_id FROM appbase_account_uuid_map WHERE old_id=appbase_accounts.id)
 WHERE id IN (SELECT old_id FROM appbase_account_uuid_map);
DROP TABLE appbase_account_uuid_guard;
DROP TABLE appbase_account_uuid_map;
PRAGMA defer_foreign_keys = OFF;
