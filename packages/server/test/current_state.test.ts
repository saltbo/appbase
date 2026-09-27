import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { D1EnvelopeSecretCodec } from "../src/adapters/envelope_secret_codec";
import { D1SyncRepository } from "../src/adapters/d1_sync_repository";
import { defaultThreeWayMerge, type JsonObject } from "../src/domain/sync";
import { pushMutations, pullChanges } from "../src/usecases/sync";
function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(
    readFileSync(
      new URL("../migrations/0001_appbase.sql", import.meta.url),
      "utf8",
    ),
  );
  const database = {
    prepare(sql: string) {
      let args: SQLInputValue[] = [];
      return {
        bind(...values: SQLInputValue[]) {
          args = values;
          return this;
        },
        async first() {
          return sqlite.prepare(sql).get(...args) ?? null;
        },
        async all() {
          return { results: sqlite.prepare(sql).all(...args), success: true };
        },
        async run() {
          return {
            meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) },
            success: true,
          };
        },
      };
    },
  } as unknown as D1Database;
  const repository = new D1SyncRepository(database);
  const migrate = () =>
    sqlite.exec(
      readFileSync(
        new URL("../migrations/0010_current_sync_state.sql", import.meta.url),
        "utf8",
      ),
    );
  const deps = {
    repository,
    secretCodec: {
      async seal(_o: string, _c: string, _r: string, p: JsonObject) {
        return p;
      },
      async open(_o: string, _c: string, _r: string, p: JsonObject) {
        return p;
      },
    },
  };
  return { sqlite, repository, migrate, deps, database };
}
test("migration preserves latest state, tombstones, cursors and legacy retry deduplication", async () => {
  const f = fixture();
  for (let i = 1; i <= 2000; i++)
    f.sqlite
      .prepare(
        `INSERT INTO appbase_records(owner_sub,collection,record_id,device_id,mutation_id,revision,payload_json,deleted,created_at) VALUES('owner','notes',?,'device',?,?,?,0,'2026-09-01T00:00:00Z')`,
      )
      .run(
        i % 2 ? "a" : "b",
        `old-${i}`,
        `r-${i}`,
        JSON.stringify({ value: i }),
      );
  f.migrate();
  expect(
    f.sqlite.prepare("SELECT count(*) n FROM appbase_records").get()?.n,
  ).toBe(2);
  expect(
    (await f.repository.listChanges("owner", 0, 500)).map(
      (r) => r.payload?.value,
    ),
  ).toEqual([1999, 2000]);
  expect(await f.repository.listChanges("owner", 2000, 500)).toEqual([]);
  expect(
    (await f.repository.listChanges("owner", 0, 500, true)).map(
      (r) => r.payload?.value,
    ),
  ).toEqual([1, 2, 1999, 2000]);
  expect(
    (await f.repository.findMutation("owner", "device", "old-1"))?.payload
      ?.value,
  ).toBe(1999);
  await pushMutations(f.deps, "owner", [
    {
      mutationId: "s1:2001:abcd",
      deviceId: "device",
      collection: "notes",
      recordId: "a",
      baseRevision: "r-1999",
      operation: "delete",
    },
  ]);
  const changes = await pullChanges(
    f.deps,
    "owner",
    Buffer.from("2000").toString("base64url"),
    500,
  );
  expect(changes.changes).toHaveLength(1);
  expect(changes.changes[0]?.deleted).toBe(true);
  f.sqlite.close();
});
test("ordered updates retain one current value and one device baseline without accepting delayed writes", async () => {
  const f = fixture();
  f.migrate();
  let revision: string | null = null;
  for (let i = 1; i <= 1000; i++) {
    const [result] = await pushMutations(f.deps, "owner", [
      {
        mutationId: `s1:${i}:AbC_dEF-123`,
        deviceId: "device",
        collection: "progress",
        recordId: "file",
        baseRevision: revision,
        operation: "put",
        payload: { position: i },
      },
    ]);
    revision = result!.change.revision;
  }
  expect(
    f.sqlite.prepare("SELECT count(*) n FROM appbase_records").get()?.n,
  ).toBe(1);
  expect(
    f.sqlite.prepare("SELECT count(*) n FROM appbase_device_record_heads").get()
      ?.n,
  ).toBe(1);
  expect(
    f.sqlite.prepare("SELECT count(*) n FROM appbase_legacy_mutations").get()
      ?.n,
  ).toBe(0);
  const [replay] = await pushMutations(f.deps, "owner", [
    {
      mutationId: "s1:1:AbC_dEF-123",
      deviceId: "device",
      collection: "progress",
      recordId: "file",
      baseRevision: null,
      operation: "delete",
    },
  ]);
  expect(replay?.status).toBe("replayed");
  expect(
    (await f.repository.getCurrent("owner", "progress", "file"))?.payload
      ?.position,
  ).toBe(1000);
  expect(await f.repository.listChanges("other", 0, 500)).toEqual([]);
  f.sqlite.close();
});
test("timestamp conflict policy preserves newer backward seeks across legacy epoch policies", () => {
  const old = {
    progressEpoch: 7,
    positionMilliseconds: 49049,
    updatedAt: "2026-09-11T03:41:39Z",
    _sync: { conflictOrder: ["progressEpoch", "positionMilliseconds"] },
  };
  const recent = {
    progressEpoch: 1,
    positionMilliseconds: 1000,
    updatedAt: "2026-09-27T16:11:22Z",
    _sync: { conflictPolicyVersion: 2, conflictOrder: ["updatedAt"] },
  };
  expect(
    defaultThreeWayMerge({ ancestor: null, server: old, client: recent }),
  ).toBe(recent);
  expect(
    defaultThreeWayMerge({ ancestor: null, server: recent, client: old }),
  ).toBe(recent);
});

test("key rotation includes current, device and creation baselines before retiring a key", async () => {
  const f = fixture();
  f.migrate();
  const keys = {
    1: Buffer.alloc(32, 1).toString("base64url"),
    2: Buffer.alloc(32, 2).toString("base64url"),
  };
  const original = new D1EnvelopeSecretCodec(f.database, {
    currentVersion: 1,
    keys,
  });
  await pushMutations({ ...f.deps, secretCodec: original }, "owner", [
    {
      mutationId: "s1:1:AbC_dEF-123",
      deviceId: "device",
      collection: "notes",
      recordId: "note",
      baseRevision: null,
      operation: "put",
      payload: { value: "encrypted" },
    },
  ]);
  const rotating = new D1EnvelopeSecretCodec(f.database, {
    currentVersion: 2,
    keys,
  });
  expect((await rotating.keyUsage())[0]?.envelopeCount).toBe(3);
  await expect(rotating.retireUserKeys(1)).rejects.toThrow(/still encrypts/u);
  expect((await rotating.reencryptBatch(1, 10)).remaining).toBe(0);
  expect(await rotating.retireUserKeys(1)).toBe(1);
  expect((await rotating.keyUsage())[0]?.envelopeCount).toBe(3);
  f.sqlite.close();
});

test("malformed ordered IDs fail without accepting a legacy write", async () => {
  const f = fixture();
  f.migrate();
  for (const id of [
    "s1:0:abcd",
    "s1:9007199254740992:abcd",
    "s1:invalid:abcd",
  ]) {
    await expect(
      pushMutations(f.deps, "owner", [
        {
          mutationId: id,
          deviceId: "device",
          collection: "notes",
          recordId: "n",
          baseRevision: null,
          operation: "put",
          payload: { value: "bad" },
        },
      ]),
    ).rejects.toThrow(/safe integer/u);
  }
  expect(
    f.sqlite.prepare("SELECT count(*) n FROM appbase_records").get()?.n,
  ).toBe(0);
  f.sqlite.close();
});

test("a newer legacy watch action cannot downgrade timestamp conflict policy", () => {
  const server = {
    updatedAt: "2026-09-27T00:00:00Z",
    positionMilliseconds: 4000,
    _sync: { conflictPolicyVersion: 2, conflictOrder: ["updatedAt"] },
  };
  const client = {
    updatedAt: "2026-09-27T00:01:00Z",
    positionMilliseconds: 1000,
    _sync: { conflictOrder: ["progressEpoch", "positionMilliseconds"] },
  };
  const result = defaultThreeWayMerge({ ancestor: null, server, client });
  expect(result?.positionMilliseconds).toBe(1000);
  expect(result?._sync).toEqual(server._sync);
});

test("a non-conflicting legacy write retains the newer policy for subsequent stale peers", async () => {
  const f = fixture();
  f.migrate();
  const mutation = (
    id: string,
    baseRevision: string | null,
    payload: JsonObject,
  ) => ({
    mutationId: id,
    deviceId: "device",
    collection: "progress",
    recordId: "file",
    baseRevision,
    operation: "put" as const,
    payload,
  });
  const [first] = await pushMutations(f.deps, "owner", [
    mutation("s1:1:abcd", null, {
      updatedAt: "2026-09-27T00:00:00Z",
      position: 10,
      _sync: { conflictPolicyVersion: 2, conflictOrder: ["updatedAt"] },
    }),
  ]);
  const [second] = await pushMutations(f.deps, "owner", [
    mutation("legacy-new", first!.change.revision, {
      updatedAt: "2026-09-27T00:01:00Z",
      position: 1,
      _sync: { conflictOrder: ["epoch", "position"] },
    }),
  ]);
  expect(second!.change.payload!._sync).toEqual(first!.change.payload!._sync);
  f.sqlite.close();
});
