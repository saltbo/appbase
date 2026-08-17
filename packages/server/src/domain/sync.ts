export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type SyncMutation = {
  mutationId: string;
  deviceId: string;
  collection: string;
  recordId: string;
  baseRevision: string | null;
  operation: "put" | "delete";
  payload?: JsonObject;
};

export type StoredVersion = {
  sequence: number;
  ownerSub: string;
  collection: string;
  recordId: string;
  deviceId: string;
  mutationId: string;
  revision: string;
  baseRevision: string | null;
  payload: JsonObject | null;
  deleted: boolean;
  createdAt: string;
};

export type SyncChange = Omit<
  StoredVersion,
  "ownerSub" | "deviceId" | "mutationId" | "baseRevision"
>;

export type MutationResult = {
  mutationId: string;
  status: "applied" | "merged" | "replayed";
  change: SyncChange;
};

export type PullResult = {
  changes: SyncChange[];
  cursor: string;
  hasMore: boolean;
};

export type MergeInput = {
  ancestor: JsonObject | null;
  server: JsonObject | null;
  client: JsonObject | null;
};

export function defaultThreeWayMerge(input: MergeInput): JsonObject | null {
  if (input.client === null) return null;
  if (input.server === null) return input.client;

  const preferred = preferredPayload(input.server, input.client);
  if (preferred !== null) return preferred;

  const ancestor = input.ancestor ?? {};
  const merged: JsonObject = { ...input.server };
  for (const [key, clientValue] of Object.entries(input.client)) {
    const ancestorValue = ancestor[key];
    const serverValue = input.server[key];
    const clientChanged = !jsonEquals(clientValue, ancestorValue);
    const serverChanged = !jsonEquals(serverValue, ancestorValue);
    if (
      clientChanged &&
      (!serverChanged || !jsonEquals(clientValue, serverValue))
    ) {
      merged[key] = clientValue;
    }
  }
  return merged;
}

function preferredPayload(
  server: JsonObject,
  client: JsonObject,
): JsonObject | null {
  const directive = client._sync;
  if (
    directive === null ||
    typeof directive !== "object" ||
    Array.isArray(directive)
  )
    return null;
  const order = directive.conflictOrder;
  if (!Array.isArray(order) || order.length === 0 || order.length > 8)
    return null;
  for (const field of order) {
    if (typeof field !== "string") return null;
    const serverValue = server[field];
    const clientValue = client[field];
    if (typeof serverValue !== "number" || typeof clientValue !== "number")
      return null;
    if (clientValue > serverValue) return client;
    if (clientValue < serverValue) return server;
  }
  return null;
}

function jsonEquals(
  left: JsonValue | undefined,
  right: JsonValue | undefined,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
