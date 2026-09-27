ALTER TABLE appbase_records ADD COLUMN mutation_order INTEGER;

CREATE TABLE appbase_device_record_heads (
  sequence INTEGER NOT NULL,
  owner_sub TEXT NOT NULL,
  collection TEXT NOT NULL,
  record_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  mutation_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  base_revision TEXT,
  payload_json TEXT,
  deleted INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  mutation_order INTEGER,
  PRIMARY KEY (owner_sub, device_id, collection, record_id)
);
CREATE INDEX appbase_device_heads_revision ON appbase_device_record_heads(owner_sub, collection, record_id, revision);

CREATE TABLE appbase_record_creation_baselines (
  sequence INTEGER NOT NULL, owner_sub TEXT NOT NULL, collection TEXT NOT NULL, record_id TEXT NOT NULL,
  device_id TEXT NOT NULL, mutation_id TEXT NOT NULL, revision TEXT NOT NULL, base_revision TEXT,
  payload_json TEXT, deleted INTEGER NOT NULL, created_at TEXT NOT NULL, mutation_order INTEGER,
  PRIMARY KEY (owner_sub,collection,record_id)
);
CREATE UNIQUE INDEX appbase_creation_record ON appbase_record_creation_baselines(owner_sub,collection,record_id);
INSERT INTO appbase_record_creation_baselines SELECT r.* FROM appbase_records r WHERE r.sequence=(
  SELECT MIN(v.sequence) FROM appbase_records v WHERE v.owner_sub=r.owner_sub AND v.collection=r.collection AND v.record_id=r.record_id
);

-- Legacy random mutation IDs have no order. Keep identifiers, not old payloads,
-- so existing clients can retry a lost response without applying that write twice.
CREATE TABLE appbase_legacy_mutations (
  owner_sub TEXT NOT NULL,
  device_id TEXT NOT NULL,
  mutation_id TEXT NOT NULL,
  collection TEXT NOT NULL,
  record_id TEXT NOT NULL,
  PRIMARY KEY (owner_sub, device_id, mutation_id)
);
INSERT INTO appbase_legacy_mutations SELECT owner_sub, device_id, mutation_id, collection, record_id FROM appbase_records;
INSERT INTO appbase_device_record_heads
SELECT r.* FROM appbase_records r WHERE r.sequence = (
  SELECT MAX(v.sequence) FROM appbase_records v
  WHERE v.owner_sub=r.owner_sub AND v.device_id=r.device_id AND v.collection=r.collection AND v.record_id=r.record_id
);
DELETE FROM appbase_records WHERE sequence NOT IN (
  SELECT MAX(sequence) FROM appbase_records GROUP BY owner_sub, collection, record_id
);
CREATE UNIQUE INDEX appbase_records_one_current ON appbase_records(owner_sub, collection, record_id);

CREATE TRIGGER appbase_current_before_insert BEFORE INSERT ON appbase_records
BEGIN
  SELECT RAISE(IGNORE) WHERE NEW.mutation_order IS NOT NULL AND EXISTS (
    SELECT 1 FROM appbase_device_record_heads h WHERE h.owner_sub=NEW.owner_sub AND h.device_id=NEW.device_id
    AND h.collection=NEW.collection AND h.record_id=NEW.record_id AND h.mutation_order >= NEW.mutation_order
  );
  DELETE FROM appbase_records WHERE owner_sub=NEW.owner_sub AND collection=NEW.collection AND record_id=NEW.record_id;
END;
CREATE TRIGGER appbase_current_after_insert AFTER INSERT ON appbase_records
BEGIN
  INSERT OR IGNORE INTO appbase_record_creation_baselines SELECT NEW.sequence,NEW.owner_sub,NEW.collection,NEW.record_id,
    NEW.device_id,NEW.mutation_id,NEW.revision,NEW.base_revision,NEW.payload_json,NEW.deleted,NEW.created_at,NEW.mutation_order;
  INSERT INTO appbase_device_record_heads VALUES (
    NEW.sequence, NEW.owner_sub, NEW.collection, NEW.record_id, NEW.device_id, NEW.mutation_id,
    NEW.revision, NEW.base_revision, NEW.payload_json, NEW.deleted, NEW.created_at, NEW.mutation_order
  ) ON CONFLICT(owner_sub,device_id,collection,record_id) DO UPDATE SET
    sequence=excluded.sequence, mutation_id=excluded.mutation_id, revision=excluded.revision,
    base_revision=excluded.base_revision, payload_json=excluded.payload_json, deleted=excluded.deleted,
    created_at=excluded.created_at, mutation_order=COALESCE(excluded.mutation_order,appbase_device_record_heads.mutation_order);
  INSERT OR IGNORE INTO appbase_legacy_mutations SELECT NEW.owner_sub,NEW.device_id,NEW.mutation_id,NEW.collection,NEW.record_id
    WHERE NEW.mutation_order IS NULL;
END;
