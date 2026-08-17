import { describe, expect, it } from "vitest";

import type { JsonObject, StoredVersion } from "../src/domain/sync";
import type {
  AppendVersionInput,
  SecretCodec,
  SyncRepository,
} from "../src/usecases/ports";
import {
  pullChanges,
  pushMutations,
  type SyncDeps,
} from "../src/usecases/sync";

// Covers: S_CLOUD_SYNC_GENERIC_COLLECTIONS case=contract

// Covers: S_CLOUD_SYNC_AUTHENTICATED_DATA case=contract
// Covers: S_CLOUD_SYNC_RESOLVE_CONFLICTS case=contract
// Covers: S_CLOUD_SYNC_WATCH_PROGRESS case=contract

class MemoryRepository implements SyncRepository {
  private readonly versions: StoredVersion[] = [];

  findMutation(
    ownerSub: string,
    deviceId: string,
    mutationId: string,
  ): Promise<StoredVersion | null> {
    return Promise.resolve(
      this.versions.find(
        (value) =>
          value.ownerSub === ownerSub &&
          value.deviceId === deviceId &&
          value.mutationId === mutationId,
      ) ?? null,
    );
  }

  getCurrent(
    ownerSub: string,
    collection: string,
    recordId: string,
  ): Promise<StoredVersion | null> {
    return Promise.resolve(
      [...this.versions]
        .reverse()
        .find(
          (value) =>
            value.ownerSub === ownerSub &&
            value.collection === collection &&
            value.recordId === recordId,
        ) ?? null,
    );
  }

  getVersion(
    ownerSub: string,
    collection: string,
    recordId: string,
    revision: string,
  ): Promise<StoredVersion | null> {
    return Promise.resolve(
      this.versions.find(
        (value) =>
          value.ownerSub === ownerSub &&
          value.collection === collection &&
          value.recordId === recordId &&
          value.revision === revision,
      ) ?? null,
    );
  }

  async append(input: AppendVersionInput): Promise<StoredVersion | null> {
    const current = await this.getCurrent(
      input.ownerSub,
      input.collection,
      input.recordId,
    );
    if ((current?.revision ?? null) !== input.expectedRevision) return null;
    const version: StoredVersion = {
      ...input,
      sequence: this.versions.length + 1,
    };
    this.versions.push(version);
    return version;
  }

  listChanges(
    ownerSub: string,
    afterSequence: number,
    limit: number,
  ): Promise<StoredVersion[]> {
    return Promise.resolve(
      this.versions
        .filter(
          (value) =>
            value.ownerSub === ownerSub && value.sequence > afterSequence,
        )
        .slice(0, limit),
    );
  }
}

const secretCodec: SecretCodec = {
  seal: (_owner, _collection, _record, payload) =>
    Promise.resolve({ sealed: JSON.stringify(payload) }),
  open: (_owner, _collection, _record, envelope) =>
    Promise.resolve(JSON.parse(String(envelope.sealed)) as JsonObject),
};

function deps(): SyncDeps {
  let revision = 0;
  return {
    repository: new MemoryRepository(),
    secretCodec,
    now: () => new Date("2026-07-12T12:00:00Z"),
    createRevision: () =>
      `00000000-0000-4000-8000-${String(++revision).padStart(12, "0")}`,
  };
}

describe("AppBase sync engine", () => {
  it("isolates users and replays an idempotent WebDAV mutation", async () => {
    const sync = deps();
    const mutation = {
      mutationId: "mutation-1",
      deviceId: "device-a",
      collection: "webdav_sources",
      recordId: "source-1",
      baseRevision: null,
      operation: "put" as const,
      payload: { rootUri: "https://dav.example.com", password: "secret" },
    };

    const first = await pushMutations(sync, "user-a", [mutation]);
    const replay = await pushMutations(sync, "user-a", [mutation]);
    const ownerPull = await pullChanges(sync, "user-a", undefined, 100);
    const otherPull = await pullChanges(sync, "user-b", undefined, 100);

    expect(first[0]?.status).toBe("applied");
    expect(replay[0]?.status).toBe("replayed");
    expect(ownerPull.changes).toHaveLength(1);
    expect(ownerPull.changes[0]?.payload).toEqual(mutation.payload);
    expect(otherPull.changes).toEqual([]);
  });

  it("merges arbitrary concurrent JSON records and advances cursors", async () => {
    const sync = deps();
    const first = await pushMutations(sync, "user-a", [
      {
        mutationId: "progress-1",
        deviceId: "device-a",
        collection: "watch_progress",
        recordId: "source-1:entry-1",
        baseRevision: null,
        operation: "put",
        payload: {
          progressEpoch: 0,
          positionMilliseconds: 1000,
          completed: false,
        },
      },
    ]);
    await pushMutations(sync, "user-a", [
      {
        mutationId: "progress-2",
        deviceId: "device-b",
        collection: "watch_progress",
        recordId: "source-1:entry-1",
        baseRevision: first[0]!.change.revision,
        operation: "put",
        payload: {
          progressEpoch: 0,
          positionMilliseconds: 8000,
          completed: false,
        },
      },
    ]);
    const merged = await pushMutations(sync, "user-a", [
      {
        mutationId: "progress-3",
        deviceId: "device-a",
        collection: "watch_progress",
        recordId: "source-1:entry-1",
        baseRevision: first[0]!.change.revision,
        operation: "put",
        payload: {
          progressEpoch: 0,
          positionMilliseconds: 4000,
          completed: false,
        },
      },
    ]);

    expect(merged[0]?.status).toBe("merged");
    expect(merged[0]?.change.payload?.positionMilliseconds).toBe(4000);
    const page = await pullChanges(sync, "user-a", undefined, 2);
    expect(page.changes).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    expect(
      (await pullChanges(sync, "user-a", page.cursor, 2)).changes,
    ).toHaveLength(1);
  });

  it("applies a client-declared lexicographic conflict order", async () => {
    const sync = deps();
    const initial = await pushMutations(sync, "user-a", [
      {
        mutationId: "progress-order-1",
        deviceId: "device-a",
        collection: "watch_progress",
        recordId: "source-1:entry-1",
        baseRevision: null,
        operation: "put",
        payload: {
          progressEpoch: 0,
          positionMilliseconds: 1000,
          _sync: { conflictOrder: ["progressEpoch", "positionMilliseconds"] },
        },
      },
    ]);
    await pushMutations(sync, "user-a", [
      {
        mutationId: "progress-order-2",
        deviceId: "device-a",
        collection: "watch_progress",
        recordId: "source-1:entry-1",
        baseRevision: initial[0]!.change.revision,
        operation: "put",
        payload: {
          progressEpoch: 0,
          positionMilliseconds: 60000,
          _sync: { conflictOrder: ["progressEpoch", "positionMilliseconds"] },
        },
      },
    ]);
    const merged = await pushMutations(sync, "user-a", [
      {
        mutationId: "progress-order-3",
        deviceId: "device-b",
        collection: "watch_progress",
        recordId: "source-1:entry-1",
        baseRevision: initial[0]!.change.revision,
        operation: "put",
        payload: {
          progressEpoch: 0,
          positionMilliseconds: 50000,
          _sync: { conflictOrder: ["progressEpoch", "positionMilliseconds"] },
        },
      },
    ]);

    expect(merged[0]?.change.payload?.positionMilliseconds).toBe(60000);
  });
});
