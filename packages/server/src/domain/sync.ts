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
  const serverDirective = server._sync;
  const clientDirective = client._sync;
  const policyVersion = (value: JsonValue | undefined): number =>
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value.conflictPolicyVersion === "number"
      ? value.conflictPolicyVersion
      : 1;
  const directive =
    policyVersion(serverDirective) > policyVersion(clientDirective)
      ? serverDirective
      : clientDirective;
  if (
    directive === null ||
    typeof directive !== "object" ||
    Array.isArray(directive)
  )
    return null;
  const retainPolicy = (payload: JsonObject): JsonObject =>
    policyVersion(payload._sync) < policyVersion(directive)
      ? { ...payload, _sync: directive }
      : payload;
  const order = directive.conflictOrder;
  if (!Array.isArray(order) || order.length === 0 || order.length > 8)
    return null;
  for (const field of order) {
    if (typeof field !== "string") return null;
    if (typeof server[field] !== typeof client[field]) return null;
    const comparable = (value: JsonValue | undefined): number | null => {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (
        typeof value === "string" &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(value)
      ) {
        const time = Date.parse(value);
        const fraction = /\.(\d+)Z$/u.exec(value)?.[1] ?? "";
        const submillisecond =
          (Number(fraction.padEnd(9, "0").slice(0, 9)) % 1000000) / 1000000;
        return Number.isFinite(time) ? time + submillisecond : null;
      }
      return null;
    };
    const serverValue = comparable(server[field]);
    const clientValue = comparable(client[field]);
    if (serverValue === null || clientValue === null) return null;
    if (clientValue > serverValue) return retainPolicy(client);
    if (clientValue < serverValue) return retainPolicy(server);
  }
  return null;
}

function jsonEquals(
  left: JsonValue | undefined,
  right: JsonValue | undefined,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class InvalidMutationOrderError extends Error {
  constructor() {
    super(
      "An ordered mutation ID must contain a positive safe integer sequence.",
    );
    this.name = "InvalidMutationOrderError";
  }
}

export function retainConflictPolicy(
  payload: JsonObject | null,
  previous: JsonObject | null,
): JsonObject | null {
  const version = (value: JsonValue | undefined): number =>
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value.conflictPolicyVersion === "number"
      ? value.conflictPolicyVersion
      : 1;
  if (payload && previous && version(previous._sync) > version(payload._sync))
    return { ...payload, _sync: previous._sync! };
  return payload;
}
