import { decodeCursor, encodeCursor } from "../domain/cursor.js";
import {
  defaultThreeWayMerge,
  type JsonObject,
  type MutationResult,
  type PullResult,
  type StoredVersion,
  type SyncChange,
  type SyncMutation,
} from "../domain/sync.js";
import {
  type SecretCodec,
  type SyncRepository,
  SyncConflictError,
} from "./ports.js";

export type SyncDeps = {
  repository: SyncRepository;
  secretCodec: SecretCodec;
  now?: () => Date;
  createRevision?: () => string;
  maxConflictRetries?: number;
};

export async function pushMutations(
  deps: SyncDeps,
  ownerSub: string,
  mutations: readonly SyncMutation[],
): Promise<MutationResult[]> {
  const results: MutationResult[] = [];
  for (const mutation of mutations) {
    results.push(await pushMutation(deps, ownerSub, mutation));
  }
  return results;
}

export async function pullChanges(
  deps: SyncDeps,
  ownerSub: string,
  cursor: string | undefined,
  limit: number,
): Promise<PullResult> {
  const afterSequence = decodeCursor(cursor);
  const versions = await deps.repository.listChanges(
    ownerSub,
    afterSequence,
    limit + 1,
  );
  const page = versions.slice(0, limit);
  const changes = await Promise.all(
    page.map((version) => publicChange(deps, version)),
  );
  const sequence = page.at(-1)?.sequence ?? afterSequence;
  return {
    changes,
    cursor: encodeCursor(sequence),
    hasMore: versions.length > limit,
  };
}

async function pushMutation(
  deps: SyncDeps,
  ownerSub: string,
  mutation: SyncMutation,
): Promise<MutationResult> {
  const replay = await deps.repository.findMutation(
    ownerSub,
    mutation.deviceId,
    mutation.mutationId,
  );
  if (replay !== null) {
    return {
      mutationId: mutation.mutationId,
      status: "replayed",
      change: await publicChange(deps, replay),
    };
  }
  const ancestor =
    mutation.baseRevision === null
      ? null
      : await deps.repository.getVersion(
          ownerSub,
          mutation.collection,
          mutation.recordId,
          mutation.baseRevision,
        );
  const rawClientPayload =
    mutation.operation === "delete" ? null : (mutation.payload ?? null);
  const clientPayload = rawClientPayload;
  const ancestorPayload =
    ancestor === null ? null : await logicalPayload(deps, ancestor);
  const maxAttempts = Math.max(1, deps.maxConflictRetries ?? 3);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const current = await deps.repository.getCurrent(
      ownerSub,
      mutation.collection,
      mutation.recordId,
    );
    const currentPayload =
      current === null ? null : await logicalPayload(deps, current);
    const conflicted = (current?.revision ?? null) !== mutation.baseRevision;
    const logical = conflicted
      ? defaultThreeWayMerge({
          ancestor: ancestorPayload,
          server: currentPayload,
          client: clientPayload,
        })
      : clientPayload;
    const storedPayload =
      logical === null
        ? null
        : await deps.secretCodec.seal(
            ownerSub,
            mutation.collection,
            mutation.recordId,
            logical,
          );
    const appended = await deps.repository.append({
      ownerSub,
      collection: mutation.collection,
      recordId: mutation.recordId,
      deviceId: mutation.deviceId,
      mutationId: mutation.mutationId,
      revision: deps.createRevision?.() ?? crypto.randomUUID(),
      baseRevision: current?.revision ?? null,
      expectedRevision: current?.revision ?? null,
      payload: storedPayload,
      deleted: logical === null,
      createdAt: (deps.now?.() ?? new Date()).toISOString(),
    });
    if (appended !== null) {
      return {
        mutationId: mutation.mutationId,
        status: conflicted ? "merged" : "applied",
        change: await publicChange(deps, appended),
      };
    }

    const concurrentReplay = await deps.repository.findMutation(
      ownerSub,
      mutation.deviceId,
      mutation.mutationId,
    );
    if (concurrentReplay !== null) {
      return {
        mutationId: mutation.mutationId,
        status: "replayed",
        change: await publicChange(deps, concurrentReplay),
      };
    }
  }

  throw new SyncConflictError(mutation.collection, mutation.recordId);
}

async function publicChange(
  deps: SyncDeps,
  version: StoredVersion,
): Promise<SyncChange> {
  return {
    sequence: version.sequence,
    collection: version.collection,
    recordId: version.recordId,
    revision: version.revision,
    payload: await logicalPayload(deps, version),
    deleted: version.deleted,
    createdAt: version.createdAt,
  };
}

async function logicalPayload(
  deps: SyncDeps,
  version: StoredVersion,
): Promise<JsonObject | null> {
  if (version.payload === null || version.deleted) return null;
  return deps.secretCodec.open(
    version.ownerSub,
    version.collection,
    version.recordId,
    version.payload,
  );
}
