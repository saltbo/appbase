import type { StoredVersion } from "../domain/sync.js";
import type { AppendVersionInput, SyncRepository } from "../usecases/ports.js";

type RecordRow = {
  sequence: number;
  owner_sub: string;
  collection: string;
  record_id: string;
  device_id: string;
  mutation_id: string;
  revision: string;
  base_revision: string | null;
  payload_json: string | null;
  deleted: number;
  created_at: string;
};

export class D1SyncRepository implements SyncRepository {
  constructor(private readonly database: D1Database) {}

  async findMutation(
    ownerSub: string,
    deviceId: string,
    mutationId: string,
  ): Promise<StoredVersion | null> {
    const row = await this.database
      .prepare(
        `SELECT * FROM appbase_records
       WHERE owner_sub = ?1 AND device_id = ?2 AND mutation_id = ?3
       LIMIT 1`,
      )
      .bind(ownerSub, deviceId, mutationId)
      .first<RecordRow>();
    return row === null ? null : mapRow(row);
  }

  async getCurrent(
    ownerSub: string,
    collection: string,
    recordId: string,
  ): Promise<StoredVersion | null> {
    const row = await this.database
      .prepare(
        `SELECT * FROM appbase_records
       WHERE owner_sub = ?1 AND collection = ?2 AND record_id = ?3
       ORDER BY sequence DESC LIMIT 1`,
      )
      .bind(ownerSub, collection, recordId)
      .first<RecordRow>();
    return row === null ? null : mapRow(row);
  }

  async getVersion(
    ownerSub: string,
    collection: string,
    recordId: string,
    revision: string,
  ): Promise<StoredVersion | null> {
    const row = await this.database
      .prepare(
        `SELECT * FROM appbase_records
       WHERE owner_sub = ?1 AND collection = ?2 AND record_id = ?3 AND revision = ?4
       LIMIT 1`,
      )
      .bind(ownerSub, collection, recordId, revision)
      .first<RecordRow>();
    return row === null ? null : mapRow(row);
  }

  async append(input: AppendVersionInput): Promise<StoredVersion | null> {
    const row = await this.database
      .prepare(
        `INSERT INTO appbase_records (
         owner_sub, collection, record_id, device_id, mutation_id, revision,
         base_revision, payload_json, deleted, created_at
       )
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10
       WHERE (
         ?11 IS NULL AND NOT EXISTS (
           SELECT 1 FROM appbase_records
           WHERE owner_sub = ?1 AND collection = ?2 AND record_id = ?3
         )
       ) OR (
         ?11 IS NOT NULL AND ?11 = (
           SELECT revision FROM appbase_records
           WHERE owner_sub = ?1 AND collection = ?2 AND record_id = ?3
           ORDER BY sequence DESC LIMIT 1
         )
       )
       ON CONFLICT(owner_sub, device_id, mutation_id) DO NOTHING
       RETURNING *`,
      )
      .bind(
        input.ownerSub,
        input.collection,
        input.recordId,
        input.deviceId,
        input.mutationId,
        input.revision,
        input.baseRevision,
        input.payload === null ? null : JSON.stringify(input.payload),
        input.deleted ? 1 : 0,
        input.createdAt,
        input.expectedRevision,
      )
      .first<RecordRow>();
    return row === null ? null : mapRow(row);
  }

  async listChanges(
    ownerSub: string,
    afterSequence: number,
    limit: number,
  ): Promise<StoredVersion[]> {
    const result = await this.database
      .prepare(
        `SELECT * FROM appbase_records
       WHERE owner_sub = ?1 AND sequence > ?2
       ORDER BY sequence ASC LIMIT ?3`,
      )
      .bind(ownerSub, afterSequence, limit)
      .all<RecordRow>();
    return result.results.map(mapRow);
  }
}

function mapRow(row: RecordRow): StoredVersion {
  const payload: unknown =
    row.payload_json === null ? null : JSON.parse(row.payload_json);
  if (
    payload !== null &&
    (typeof payload !== "object" || Array.isArray(payload))
  ) {
    throw new Error("Stored AppBase payload is not an object.");
  }
  return {
    sequence: row.sequence,
    ownerSub: row.owner_sub,
    collection: row.collection,
    recordId: row.record_id,
    deviceId: row.device_id,
    mutationId: row.mutation_id,
    revision: row.revision,
    baseRevision: row.base_revision,
    payload: payload as Record<
      string,
      import("../domain/sync").JsonValue
    > | null,
    deleted: row.deleted === 1,
    createdAt: row.created_at,
  };
}
