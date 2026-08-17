import { describe, expect, it } from "vitest";

import { createAppBase, type AppBasePublicConfig } from "../src/http/app";
import type { StoredVersion } from "../src/domain/sync";
import type {
  AppendVersionInput,
  SecretCodec,
  SyncRepository,
} from "../src/usecases/ports";

const config: AppBasePublicConfig = {
  protocolVersions: ["2026-08-17"],
  issuer: "https://id.example/auth",
  clientId: "client-id",
  audience: "https://api.example",
  usesResourceIndicator: false,
  acceptsDynamicCollections: true,
  encryptsAllPayloads: true,
  maxMutationsPerBatch: 50,
  maxChangesPerPage: 500,
  maxPayloadBytes: 64 * 1024,
};

describe("AppBase HTTP protocol", () => {
  it("publishes configuration with request correlation and observation", async () => {
    const events: unknown[] = [];
    const app = appForPrincipal({ observe: (event) => events.push(event) });

    const response = await app.request(
      "/client-configuration",
      {
        headers: { "Request-Id": "request-1", traceparent: "00-trace-parent" },
      },
      {},
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Request-Id")).toBe("request-1");
    expect(response.headers.get("traceparent")).toBe("00-trace-parent");
    expect(await response.json()).toMatchObject({
      protocolVersions: ["2026-08-17"],
      maxMutationsPerBatch: 50,
    });
    expect(events).toHaveLength(1);
  });

  it("allows an authenticated principal to pull arbitrary collections", async () => {
    const app = appForPrincipal();

    const response = await app.request(
      "/changes",
      {
        headers: { Authorization: "Bearer token", "API-Version": "2026-08-17" },
      },
      {},
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      items: [],
      pagination: { pageSize: 200 },
    });
  });

  it("requires a supported version and validates pagination", async () => {
    const app = appForPrincipal();

    const missing = await app.request("/changes", {}, {});
    const invalid = await app.request(
      "/changes?pageSize=0",
      {
        headers: { "API-Version": "2026-08-17" },
      },
      {},
    );

    expect(missing.status).toBe(400);
    expect(missing.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    expect(await missing.json()).toMatchObject({
      code: "UNSUPPORTED_API_VERSION",
      status: 400,
    });
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toMatchObject({ code: "VALIDATION_ERROR" });

    const badToken = await app.request(
      "/changes?pageToken=not-a-cursor",
      {
        headers: { "API-Version": "2026-08-17" },
      },
      {},
    );
    expect(badToken.status).toBe(400);
    expect(await badToken.json()).toMatchObject({ code: "INVALID_PAGE_TOKEN" });
  });

  it("fails fast for invalid server limits and redacts unexpected errors", async () => {
    expect(() =>
      appForPrincipal({
        publicConfig: { ...config, protocolVersions: [] },
      }),
    ).toThrow(/must support/u);
    expect(() =>
      appForPrincipal({
        publicConfig: { ...config, maxChangesPerPage: 0 },
      }),
    ).toThrow(/positive integer/u);

    const app = appForPrincipal({ repository: new FailingRepository() });
    const response = await app.request(
      "/changes",
      {
        headers: { "API-Version": "2026-08-17" },
      },
      {},
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      code: "INTERNAL_ERROR",
      detail: "The AppBase request could not be completed.",
    });
  });

  it("applies and replays canonical mutation batches", async () => {
    const repository = new MemoryRepository();
    const app = appForPrincipal({ repository });
    const send = () =>
      app.request(
        "/mutation-batches/batch-1",
        {
          method: "PUT",
          headers: {
            "API-Version": "2026-08-17",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            mutations: [
              {
                mutationId: "mutation-1",
                deviceId: "device-1",
                collection: "notes",
                recordId: "note-1",
                baseRevision: null,
                operation: "put",
                payload: { title: "Hello" },
              },
            ],
          }),
        },
        {},
      );

    const first = await send();
    const replay = await send();

    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      id: "batch-1",
      results: [{ status: "applied" }],
    });
    expect(await replay.json()).toMatchObject({
      results: [{ status: "replayed" }],
    });
  });

  it("rejects malformed, oversized, and forbidden mutation requests", async () => {
    const denied = appForPrincipal({ authorize: () => false });
    const forbidden = await denied.request(
      "/mutation-batches/batch-1",
      {
        method: "PUT",
        headers: {
          "API-Version": "2026-08-17",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ mutations: [] }),
      },
      {},
    );
    expect(forbidden.status).toBe(403);

    const tiny = appForPrincipal({
      publicConfig: { ...config, maxPayloadBytes: 3 },
      repository: new MemoryRepository(),
    });
    const oversized = await tiny.request(
      "/mutation-batches/batch-1",
      {
        method: "PUT",
        headers: {
          "API-Version": "2026-08-17",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mutations: [
            {
              mutationId: "mutation-1",
              deviceId: "device-1",
              collection: "notes",
              recordId: "note-1",
              baseRevision: null,
              operation: "put",
              payload: { value: "too large" },
            },
          ],
        }),
      },
      {},
    );
    expect(oversized.status).toBe(413);

    const malformed = await tiny.request(
      "/mutation-batches/not/valid",
      {
        method: "PUT",
        headers: { "API-Version": "2026-08-17", "Content-Type": "text/plain" },
        body: "not-json",
      },
      {},
    );
    expect(malformed.status).toBe(404);
  });

  it("keeps the legacy v1 transport available during migration", async () => {
    const app = appForPrincipal({ legacyV1: true });

    const configResponse = await app.request("/config", {}, {});
    const pull = await app.request("/sync/changes", {}, {});

    expect(configResponse.headers.get("Deprecation")).toBe("true");
    expect(await configResponse.json()).toMatchObject({
      data: { protocolVersion: 1 },
    });
    expect(await pull.json()).toMatchObject({
      changes: [],
      cursor: "MA",
      hasMore: false,
    });
  });
});

function appForPrincipal(
  overrides: {
    repository?: SyncRepository;
    authorize?: () => boolean;
    legacyV1?: boolean;
    publicConfig?: AppBasePublicConfig;
    observe?: (event: import("../src/http/app").AppBaseRequestEvent) => void;
  } = {},
) {
  return createAppBase<Record<string, never>>({
    publicConfig: overrides.publicConfig ?? config,
    principal: () => ({ sub: "user-1", scopes: ["openid"] }),
    createDeps: () => ({
      repository: overrides.repository ?? new EmptyRepository(),
      secretCodec: new PassthroughCodec(),
      now: () => new Date("2026-08-17T00:00:00Z"),
      createRevision: () => "00000000-0000-4000-8000-000000000001",
    }),
    ...(overrides.authorize === undefined
      ? {}
      : { authorize: overrides.authorize }),
    ...(overrides.legacyV1 === undefined
      ? {}
      : { legacyV1: overrides.legacyV1 }),
    ...(overrides.observe === undefined ? {} : { observe: overrides.observe }),
  });
}

class MemoryRepository implements SyncRepository {
  private readonly values: StoredVersion[] = [];
  findMutation(
    ownerSub: string,
    deviceId: string,
    mutationId: string,
  ): Promise<StoredVersion | null> {
    return Promise.resolve(
      this.values.find(
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
      this.values.findLast(
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
      this.values.find(
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
    const stored = { ...input, sequence: this.values.length + 1 };
    this.values.push(stored);
    return stored;
  }
  listChanges(
    ownerSub: string,
    afterSequence: number,
    limit: number,
  ): Promise<StoredVersion[]> {
    return Promise.resolve(
      this.values
        .filter(
          (value) =>
            value.ownerSub === ownerSub && value.sequence > afterSequence,
        )
        .slice(0, limit),
    );
  }
}

class EmptyRepository implements SyncRepository {
  findMutation(): Promise<StoredVersion | null> {
    return Promise.resolve(null);
  }
  getCurrent(): Promise<StoredVersion | null> {
    return Promise.resolve(null);
  }
  getVersion(): Promise<StoredVersion | null> {
    return Promise.resolve(null);
  }
  append(_input: AppendVersionInput): Promise<StoredVersion | null> {
    return Promise.resolve(null);
  }
  listChanges(): Promise<StoredVersion[]> {
    return Promise.resolve([]);
  }
}

class FailingRepository extends EmptyRepository {
  override listChanges(): Promise<StoredVersion[]> {
    throw new Error("database details must not escape");
  }
}

class PassthroughCodec implements SecretCodec {
  seal(
    _ownerSub: string,
    _collection: string,
    _recordId: string,
    payload: import("../src/domain/sync").JsonObject,
  ) {
    return Promise.resolve(payload);
  }
  open(
    _ownerSub: string,
    _collection: string,
    _recordId: string,
    payload: import("../src/domain/sync").JsonObject,
  ) {
    return Promise.resolve(payload);
  }
}
