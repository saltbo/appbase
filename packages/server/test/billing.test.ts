import { describe, it, expect } from "vitest";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  BillingService,
  type BillingProvider,
} from "../src/usecases/billing.js";
import { BillingMembershipRepository } from "../src/usecases/billing_membership_repository.js";
import { D1MembershipRepository } from "../src/adapters/d1_membership_repository.js";
import { D1BillingRepository } from "../src/adapters/d1_billing_repository.js";
import {
  billingGrant,
  validateCatalog,
  type BillingCatalog,
  type BillingState,
} from "../src/domain/billing.js";
import { MembershipService } from "../src/usecases/membership.js";
import {
  RevenueCatProvider,
  verifyWebhookAuthorization,
  boundedText,
} from "../src/adapters/revenuecat.js";
import { billingOpenApi } from "../src/http/billing_contract.js";
import contract from "../../../protocol/billing.openapi.json" with { type: "json" };
import fixture from "../../../protocol/fixtures/billing-contract.json" with { type: "json" };
import { createBilling } from "../src/http/billing.js";
import { AuthenticationError } from "../src/usecases/ports.js";

const catalog: BillingCatalog = {
  freePlan: {
    id: "free",
    capabilities: { ai: { limit: 2, period: "utc_month" } },
  },
  plans: [
    { id: "plus", capabilities: { ai: { limit: 10, period: "utc_month" } } },
  ],
  entitlementPlans: { premium: "plus" },
  honorGracePeriod: true,
};
const now = "2026-09-07T00:00:00.000Z";
const state: BillingState = {
  observedAt: now,
  managementUrl: null,
  entitlements: [
    {
      id: "premium",
      productId: "annual",
      store: "app_store",
      sandbox: false,
      startsAt: "2026-09-01T00:00:00.000Z",
      expiresAt: "2026-10-01T00:00:00.000Z",
      graceEndsAt: null,
      willRenew: true,
    },
  ],
};

// Real SQLite executes the D1 adapter's SQL; the product also exercises it in workerd.
function database(): D1Database {
  const db = new DatabaseSync(":memory:");
  db.exec(
    readFileSync(
      new URL("../migrations/0003_billing.sql", import.meta.url),
      "utf8",
    ),
  );
  db.exec(`CREATE TABLE appbase_membership_grants(id TEXT PRIMARY KEY, owner_sub TEXT, plan_id TEXT, source TEXT, starts_at TEXT, ends_at TEXT, created_at TEXT);
    CREATE TABLE appbase_membership_usage(owner_sub TEXT, capability TEXT, period_key TEXT, item_key TEXT, created_at TEXT, UNIQUE(owner_sub,capability,period_key,item_key));`);
  const prepare = (
    sql: string,
    args: SQLInputValue[] = [],
  ): D1PreparedStatement =>
    ({
      bind: (...values: SQLInputValue[]) => prepare(sql, values),
      first: async () => db.prepare(sql).get(...args) ?? null,
      run: async () => ({
        success: true,
        meta: { changes: Number(db.prepare(sql).run(...args).changes) },
      }),
    }) as D1PreparedStatement;
  return { prepare } as D1Database;
}
function setup(provider: BillingProvider = { subscriber: async () => state }) {
  const db = database();
  const repository = new D1BillingRepository(db);
  const service = new BillingService(repository, provider, catalog);
  return { db, repository, service };
}

describe("billing catalog and grants", () => {
  it("changes limits remotely while preserving accounting identities", async () => {
    const { repository, service, db } = setup();
    const loadCatalog = async () => (await service.catalog()).catalog;
    const membership = new MembershipService(
      new BillingMembershipRepository(
        new D1MembershipRepository(db),
        repository,
        loadCatalog,
        false,
      ),
      { ...catalog, loadCatalog, now: () => new Date(now) },
    );
    expect((await service.catalog()).revision).toBe(0);
    expect(await membership.limit("a", "ai")).toBe(2);
    await service.synchronize("a");
    expect(await membership.limit("a", "ai")).toBe(10);
    const updated: BillingCatalog = {
      ...catalog,
      plans: [
        {
          id: "plus",
          capabilities: { ai: { limit: 42, period: "utc_month" } },
        },
      ],
    };
    await service.replaceCatalog(updated, 0);
    expect(await membership.limit("a", "ai")).toBe(42);
    await expect(service.replaceCatalog(catalog, 0)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    await service.replaceCatalog(catalog, 1);
    expect(await membership.limit("a", "ai")).toBe(10);
    const unmapped = { ...catalog, entitlementPlans: {} };
    await service.replaceCatalog(unmapped, 2);
    expect(await membership.limit("a", "ai")).toBe(2);
    expect(await membership.limit("b", "ai")).toBe(2);
  });
  it.each([
    { ...catalog, plans: [] },
    { ...catalog, freePlan: { ...catalog.freePlan, id: "other" } },
    { ...catalog, entitlementPlans: { premium: "missing" } },
    { ...catalog, plans: [catalog.plans[0]!, catalog.plans[0]!] },
    { ...catalog, freePlan: { id: "free", capabilities: {} } },
    {
      ...catalog,
      freePlan: {
        id: "free",
        capabilities: { ai: { limit: -1, period: "utc_month" as const } },
      },
    },
    {
      ...catalog,
      freePlan: {
        id: "free",
        capabilities: { ai: { limit: 1, period: "lifetime" as const } },
      },
    },
  ])("rejects incompatible or invalid catalogs", (value) =>
    expect(() => validateCatalog(value, catalog)).toThrow(),
  );
  it("honors configured grace, environment and expiry at the boundary", () => {
    expect(billingGrant(null, catalog, now, false)).toBeNull();
    expect(billingGrant(state, catalog, now, true)).toBeNull();
    expect(
      billingGrant(state, catalog, "2026-10-01T00:00:00.000Z", false),
    ).toBeNull();
    expect(
      billingGrant(state, catalog, "2026-08-01T00:00:00.000Z", false),
    ).toBeNull();
    const grace = {
      ...state,
      entitlements: [
        {
          ...state.entitlements[0]!,
          expiresAt: now,
          graceEndsAt: "2026-09-10T00:00:00.000Z",
        },
      ],
    };
    expect(billingGrant(grace, catalog, now, false)?.endsAt).toBe(
      "2026-09-10T00:00:00.000Z",
    );
    expect(
      billingGrant(grace, { ...catalog, honorGracePeriod: false }, now, false),
    ).toBeNull();
  });
});

describe("subscription persistence and synchronization", () => {
  it("keeps identities stable and does not fabricate unknown owners", async () => {
    const { repository } = setup();
    const id = await repository.identity("a");
    expect(await repository.identity("a")).toBe(id);
    expect(await repository.identity("b")).not.toBe(id);
    expect(await repository.owner(id)).toBe("a");
    expect(await repository.owner("unknown")).toBeNull();
    expect(await repository.state("unknown")).toBeNull();
    await expect(repository.beginSync("unknown")).rejects.toThrow();
  });
  it("never lets a slower snapshot overwrite a later synchronization", async () => {
    let release!: (value: BillingState) => void;
    let first = true;
    const { repository, service } = setup({
      subscriber: async () => {
        if (first) {
          first = false;
          return new Promise((resolve) => {
            release = resolve;
          });
        }
        return { ...state, entitlements: [] };
      },
    });
    const older = service.synchronize("a");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await service.synchronize("a");
    release(state);
    await expect(older).rejects.toMatchObject({ code: "SYNC_SUPERSEDED" });
    expect((await repository.state("a"))?.entitlements).toEqual([]);
  });
  it("deduplicates successful webhooks and reconciles both transfer owners", async () => {
    const calls: string[] = [];
    const { repository, service } = setup({
      subscriber: async (id) => {
        calls.push(id);
        return state;
      },
    });
    const a = await repository.identity("a");
    const b = await repository.identity("b");
    const event = { id: "event", userIds: [a, a, b, "unknown"] };
    await service.webhook(event);
    await service.webhook(event);
    expect(calls).toEqual([a, b]);
    expect(await repository.eventProcessed("event")).toBe(true);
  });
  it("does not mark provider failures processed or destroy previous state", async () => {
    const { repository, service } = setup({
      subscriber: async () => {
        throw new Error("offline");
      },
    });
    const id = await repository.identity("a");
    await repository.commitSync("a", 0, state);
    await expect(
      service.webhook({ id: "retry", userIds: [id] }),
    ).rejects.toThrow("offline");
    expect(await repository.eventProcessed("retry")).toBe(false);
    expect(await repository.state("a")).toEqual(state);
  });
});

const payload = () => ({
  request_date: now,
  subscriber: {
    management_url: null as string | null,
    entitlements: {
      premium: {
        product_identifier: "annual",
        purchase_date: state.entitlements[0]!.startsAt,
        expires_date: state.entitlements[0]!.expiresAt as string | null,
      },
    },
    subscriptions: {
      annual: {
        store: "app_store",
        is_sandbox: false,
        unsubscribe_detected_at: null as string | null,
        refunded_at: null as string | null,
      },
    },
  },
});
function provider(body: unknown, status = 200) {
  return new RevenueCatProvider(
    "server-key",
    async () => new Response(JSON.stringify(body), { status }),
  );
}

describe("RevenueCat boundary", () => {
  it("normalizes verified subscription data including cancelled renewals and refunds", async () => {
    expect(await provider(payload()).subscriber("a")).toEqual(state);
    const cancelled = payload();
    cancelled.subscriber.subscriptions.annual.unsubscribe_detected_at = now;
    expect(
      (await provider(cancelled).subscriber("a")).entitlements[0]?.willRenew,
    ).toBe(false);
    const refund = payload();
    refund.subscriber.subscriptions.annual.refunded_at = now;
    expect((await provider(refund).subscriber("a")).entitlements).toEqual([]);
  });
  it("uses a server credential and encodes customer identity", async () => {
    const gateway = new RevenueCatProvider("secret", async function (
      this: unknown,
      url,
      options,
    ) {
      expect(this).toBeUndefined();
      expect(url).toBe("https://api.revenuecat.com/v1/subscribers/a%2Fb");
      expect(options?.headers).toMatchObject({
        Authorization: "Bearer secret",
      });
      expect(options?.redirect).toBe("manual");
      return new Response(JSON.stringify(payload()));
    });
    await gateway.subscriber("a/b");
  });
  it("rejects unavailable and malformed provider responses", async () => {
    await expect(provider({}, 302).subscriber("a")).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
    await expect(provider({}, 503).subscriber("a")).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
    await expect(provider({}).subscriber("a")).rejects.toMatchObject({
      code: "INVALID_PROVIDER_RESPONSE",
    });
    await expect(
      new RevenueCatProvider("").subscriber("a"),
    ).rejects.toMatchObject({ code: "CONFIGURATION_MISSING" });
    await expect(
      new RevenueCatProvider("key", async () => {
        throw new Error("timeout");
      }).subscriber("a"),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    const missing = payload();
    missing.subscriber.subscriptions =
      {} as typeof missing.subscriber.subscriptions;
    await expect(provider(missing).subscriber("a")).rejects.toThrow();
    const lifetime = payload();
    lifetime.subscriber.entitlements.premium.expires_date = null;
    await expect(provider(lifetime).subscriber("a")).rejects.toThrow();
    const url = payload();
    url.subscriber.management_url = "http://insecure.example";
    await expect(provider(url).subscriber("a")).rejects.toThrow();
    await expect(boundedText(new Response("large"), 2)).rejects.toThrow();
    expect(await boundedText(new Response(null))).toBe("");
  });
  it("authenticates callback secrets", async () => {
    expect(
      await verifyWebhookAuthorization("Bearer correct", "Bearer correct"),
    ).toBe(true);
    expect(
      await verifyWebhookAuthorization("Bearer wrong", "Bearer correct"),
    ).toBe(false);
    expect(await verifyWebhookAuthorization(undefined, "Bearer correct")).toBe(
      false,
    );
    expect(await verifyWebhookAuthorization("anything", "")).toBe(false);
  });
});

describe("billing HTTP", () => {
  it("exports the same billing protocol that independently released clients use", () => {
    expect(billingOpenApi).toEqual(contract);
  });
  it("serves the shared Flutter account contract", async () => {
    const response = await app().request("/account", {
      headers: { Authorization: "a" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ...fixture.account,
      appUserId: expect.any(String),
    });
  });
  function app() {
    const { service } = setup();
    return createBilling({
      service: () => service,
      sdkKeys: () => ({ ios: "public-ios", android: "public-android" }),
      webhookAuthorization: () => "webhook-secret",
      authenticate: async (request) => {
        const token = request.headers.get("Authorization");
        if (!token) throw new AuthenticationError("missing");
        return {
          sub: token,
          scopes: token === "admin" ? ["billing:configure"] : [],
        };
      },
      authorize: (p, capability) =>
        capability !== "billing:configure" || p.scopes.includes(capability),
    });
  }
  it("isolates customer identity from request input and excludes secret credentials", async () => {
    const api = app();
    expect((await api.request("/account")).status).toBe(401);
    const response = await api.request("/account?owner=other", {
      headers: { Authorization: "a" },
    });
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.text()).not.toContain("server-key");
    expect(
      (
        await api.request("/synchronizations", {
          method: "POST",
          headers: { Authorization: "a" },
          body: '{"owner":"b"}',
        })
      ).status,
    ).toBe(200);
  });
  it("requires administrator authority and exact catalog preconditions", async () => {
    const api = app();
    expect(
      (await api.request("/configuration", { headers: { Authorization: "a" } }))
        .status,
    ).toBe(403);
    const response = await api.request("/configuration", {
      headers: { Authorization: "admin" },
    });
    expect(response.headers.get("ETag")).toBe('"0"');
    const put = (etag?: string, body = catalog) =>
      api.request("/configuration", {
        method: "PUT",
        headers: {
          Authorization: "admin",
          ...(etag ? { "If-Match": etag } : {}),
        },
        body: JSON.stringify(body),
      });
    expect((await put()).status).toBe(428);
    expect((await put("bad")).status).toBe(412);
    expect((await put('"0"')).status).toBe(200);
    expect((await put('"0"')).status).toBe(412);
    expect((await put('"1"', { ...catalog, plans: [] })).status).toBe(422);
  });
  it("authenticates webhook deliveries separately and acknowledges only success", async () => {
    const api = app();
    const post = (secret: string, event: unknown) =>
      api.request("/webhooks/revenuecat", {
        method: "POST",
        headers: { Authorization: secret },
        body: JSON.stringify({ event }),
      });
    expect((await post("bad", {})).status).toBe(401);
    expect((await post("webhook-secret", {})).status).toBe(422);
    expect(
      (await post("webhook-secret", { id: "1", type: "TEST" })).status,
    ).toBe(204);
    expect(
      (await post("webhook-secret", { id: "2", type: "RENEWAL" })).status,
    ).toBe(422);
    expect(
      (
        await post("webhook-secret", {
          id: "3",
          type: "TRANSFER",
          transferred_from: ["unknown"],
          transferred_to: ["unknown2"],
        })
      ).status,
    ).toBe(204);
  });
});
