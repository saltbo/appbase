import { describe, expect, it } from "vitest";

import {
  D1EnvelopeSecretCodec,
  type MasterKeyring,
} from "../src/adapters/envelope_secret_codec";
import type { JsonObject } from "../src/domain/sync";

describe("D1 envelope key rotation", () => {
  it("reencrypts bounded batches, reports usage, and retires old user keys", async () => {
    const database = new MemoryD1();
    const versionOne = new D1EnvelopeSecretCodec(
      database as unknown as D1Database,
      keyring(1),
    );
    database.records.push(
      {
        sequence: 1,
        owner_sub: "user-1",
        collection: "notes",
        record_id: "note-1",
        payload_json: JSON.stringify(
          await versionOne.seal("user-1", "notes", "note-1", {
            title: "one",
          }),
        ),
      },
      {
        sequence: 2,
        owner_sub: "user-1",
        collection: "notes",
        record_id: "note-2",
        payload_json: JSON.stringify(
          await versionOne.seal("user-1", "notes", "note-2", {
            title: "two",
          }),
        ),
      },
    );
    const rotating = new D1EnvelopeSecretCodec(
      database as unknown as D1Database,
      keyring(2),
    );

    expect(await rotating.keyUsage()).toEqual([
      { keyVersion: 1, envelopeCount: 2, userKeyCount: 1 },
    ]);
    await expect(rotating.retireUserKeys(1)).rejects.toThrow(/still encrypts/u);

    expect(await rotating.reencryptBatch(1, 1)).toEqual({
      fromVersion: 1,
      toVersion: 2,
      selected: 1,
      migrated: 1,
      skipped: 0,
      remaining: 1,
    });
    expect((await rotating.reencryptBatch(1, 10)).remaining).toBe(0);

    for (const record of database.records) {
      await expect(
        rotating.open(
          record.owner_sub,
          record.collection,
          record.record_id,
          JSON.parse(record.payload_json) as JsonObject,
        ),
      ).resolves.toMatchObject({ title: expect.any(String) });
    }
    expect(await rotating.keyUsage()).toEqual([
      { keyVersion: 1, envelopeCount: 0, userKeyCount: 1 },
      { keyVersion: 2, envelopeCount: 2, userKeyCount: 1 },
    ]);
    expect(await rotating.retireUserKeys(1)).toBe(1);
    expect(await rotating.keyUsage()).toEqual([
      { keyVersion: 2, envelopeCount: 2, userKeyCount: 1 },
    ]);
  });

  it("rejects unsafe rotation requests", async () => {
    const codec = new D1EnvelopeSecretCodec(
      new MemoryD1() as unknown as D1Database,
      keyring(2),
    );

    await expect(codec.reencryptBatch(2)).rejects.toThrow(/current/u);
    await expect(codec.reencryptBatch(1, 0)).rejects.toThrow(/batch size/u);
    await expect(codec.retireUserKeys(2)).rejects.toThrow(/current/u);
  });
});

function keyring(currentVersion: number): MasterKeyring {
  return {
    currentVersion,
    keys: {
      1: base64Url(new Uint8Array(32).fill(1)),
      2: base64Url(new Uint8Array(32).fill(2)),
    },
  };
}

function base64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

type UserKey = {
  owner_sub: string;
  key_version: number;
  wrapped_key: string;
  wrap_nonce: string;
};

type RecordRow = {
  sequence: number;
  owner_sub: string;
  collection: string;
  record_id: string;
  payload_json: string;
};

class MemoryD1 {
  readonly userKeys: UserKey[] = [];
  readonly records: RecordRow[] = [];

  prepare(query: string): MemoryStatement {
    return new MemoryStatement(this, query.replace(/\s+/gu, " ").trim());
  }
}

class MemoryStatement {
  private values: unknown[] = [];

  constructor(
    private readonly database: MemoryD1,
    private readonly query: string,
  ) {}

  bind(...values: unknown[]): this {
    this.values = values;
    return this;
  }

  first<T>(): Promise<T | null> {
    if (this.query.startsWith("SELECT wrapped_key")) {
      const row = this.database.userKeys.find(
        (value) =>
          value.owner_sub === this.values[0] &&
          value.key_version === this.values[1],
      );
      return Promise.resolve((row ?? null) as T | null);
    }
    if (this.query.startsWith("SELECT COUNT(*) AS item_count")) {
      const version = this.values[0];
      const item_count = this.database.records.filter(
        (record) => keyVersion(record.payload_json) === version,
      ).length;
      return Promise.resolve({ item_count } as T);
    }
    throw new Error(`Unsupported first query: ${this.query}`);
  }

  all<T>(): Promise<D1Result<T>> {
    if (this.query.startsWith("SELECT CAST(json_extract")) {
      return Promise.resolve(
        result(groupVersions(this.database.records)) as D1Result<T>,
      );
    }
    if (this.query.startsWith("SELECT key_version, COUNT(*)")) {
      return Promise.resolve(
        result(groupUserKeys(this.database.userKeys)) as D1Result<T>,
      );
    }
    if (this.query.startsWith("SELECT sequence, owner_sub")) {
      const version = this.values[0];
      const limit = this.values[1] as number;
      const rows = this.database.records
        .filter((record) => keyVersion(record.payload_json) === version)
        .sort((left, right) => left.sequence - right.sequence)
        .slice(0, limit);
      return Promise.resolve(result(rows) as D1Result<T>);
    }
    throw new Error(`Unsupported all query: ${this.query}`);
  }

  run<T>(): Promise<D1Result<T>> {
    if (this.query.startsWith("INSERT OR IGNORE INTO appbase_user_keys")) {
      const [owner_sub, key_version, wrapped_key, wrap_nonce] = this.values as [
        string,
        number,
        string,
        string,
      ];
      const exists = this.database.userKeys.some(
        (value) =>
          value.owner_sub === owner_sub && value.key_version === key_version,
      );
      if (!exists) {
        this.database.userKeys.push({
          owner_sub,
          key_version,
          wrapped_key,
          wrap_nonce,
        });
      }
      return Promise.resolve(result([], exists ? 0 : 1) as D1Result<T>);
    }
    if (this.query.startsWith("UPDATE appbase_records")) {
      const [payload, sequence, previous] = this.values as [
        string,
        number,
        string,
      ];
      const record = this.database.records.find(
        (value) =>
          value.sequence === sequence && value.payload_json === previous,
      );
      if (record !== undefined) record.payload_json = payload;
      return Promise.resolve(
        result([], record === undefined ? 0 : 1) as D1Result<T>,
      );
    }
    if (this.query.startsWith("DELETE FROM appbase_user_keys")) {
      const version = this.values[0];
      const retained = this.database.userKeys.filter(
        (value) => value.key_version !== version,
      );
      const changes = this.database.userKeys.length - retained.length;
      this.database.userKeys.splice(
        0,
        this.database.userKeys.length,
        ...retained,
      );
      return Promise.resolve(result([], changes) as D1Result<T>);
    }
    throw new Error(`Unsupported run query: ${this.query}`);
  }
}

function keyVersion(payload: string): number {
  return (JSON.parse(payload) as { keyVersion: number }).keyVersion;
}

function groupVersions(records: RecordRow[]) {
  const counts = new Map<number, number>();
  for (const record of records) {
    const version = keyVersion(record.payload_json);
    counts.set(version, (counts.get(version) ?? 0) + 1);
  }
  return [...counts].map(([key_version, item_count]) => ({
    key_version,
    item_count,
  }));
}

function groupUserKeys(keys: UserKey[]) {
  const counts = new Map<number, number>();
  for (const key of keys) {
    counts.set(key.key_version, (counts.get(key.key_version) ?? 0) + 1);
  }
  return [...counts].map(([key_version, item_count]) => ({
    key_version,
    item_count,
  }));
}

function result<T>(results: T[], changes = 0): D1Result<T> {
  return {
    success: true,
    results,
    meta: {
      duration: 0,
      size_after: 0,
      rows_read: 0,
      rows_written: changes,
      last_row_id: 0,
      changed_db: changes > 0,
      changes,
    },
  };
}
