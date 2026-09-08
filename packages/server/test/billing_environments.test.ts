import { describe, it, expect } from "vitest";
import { database } from "./support/billing_database.js";
import { D1BillingRepository } from "../src/adapters/d1_billing_repository.js";
import { D1MembershipRepository } from "../src/adapters/d1_membership_repository.js";
import { BillingService } from "../src/usecases/billing.js";
import { BillingMembershipRepository } from "../src/usecases/billing_membership_repository.js";
import { MembershipService } from "../src/usecases/membership.js";
import { RevenueCatProvider } from "../src/adapters/revenuecat.js";
import { createBilling } from "../src/http/billing.js";
import type { BillingCatalog, BillingState } from "../src/domain/billing.js";
import { Hono } from "hono";
const now = "2026-09-07T00:00:00.000Z";
const catalog: BillingCatalog = {
  freePlan: {
    id: "free",
    capabilities: { ai: { limit: 1, period: "utc_month" } },
  },
  plans: [
    { id: "pro", capabilities: { ai: { limit: 10, period: "utc_month" } } },
  ],
  entitlementPlans: { pro: "pro" },
  honorGracePeriod: true,
};
const state = (sandbox = false): BillingState => ({
  observedAt: now,
  managementUrl: null,
  entitlements: [
    {
      id: "pro",
      productId: "monthly",
      store: "app_store",
      sandbox,
      startsAt: now,
      expiresAt: "2026-10-07T00:00:00.000Z",
      graceEndsAt: null,
      willRenew: true,
    },
  ],
});

// Covers: S_BILLING_ENVIRONMENTS case=contract
// Covers: S_ACCOUNT_BILLING_ENVIRONMENT_ISOLATION case=contract
describe("billing environments in one database", () => {
  it("preserves every legacy row as production and keeps account identities stable", async () => {
    const db = database((sql) => {
      sql.exec(`INSERT INTO appbase_records(owner_sub,collection,record_id,device_id,mutation_id,revision,payload_json,created_at)
        VALUES ('owner','library','record','device','mutation','revision','encrypted-payload','${now}');
        INSERT INTO appbase_user_keys VALUES ('owner',1,'wrapped-key','nonce','${now}');`);
      sql
        .prepare("INSERT INTO appbase_billing_catalog VALUES (1, 3, ?)")
        .run(JSON.stringify(catalog));
      sql
        .prepare(
          "INSERT INTO appbase_billing_accounts VALUES ('owner', 'existing-id', 7, ?)",
        )
        .run(JSON.stringify(state()));
      sql.exec(`INSERT INTO appbase_billing_events VALUES ('event', '${now}');
        INSERT INTO appbase_membership_grants VALUES ('grant', 'owner', 'pro', 'admin', '${now}', NULL, '${now}');
        INSERT INTO appbase_membership_usage VALUES ('owner', 'ai', '2026-09', 'item', '${now}');`);
    });
    expect(
      await db
        .prepare(
          "SELECT owner_sub, sequence, revision, device_id, payload_json FROM appbase_records",
        )
        .first(),
    ).toEqual({
      owner_sub: "owner",
      sequence: 1,
      revision: "revision",
      device_id: "device",
      payload_json: "encrypted-payload",
    });
    expect(
      await db
        .prepare(
          "SELECT owner_sub, wrapped_key, wrap_nonce FROM appbase_user_keys",
        )
        .first(),
    ).toEqual({
      owner_sub: "owner",
      wrapped_key: "wrapped-key",
      wrap_nonce: "nonce",
    });
    const prod = new D1BillingRepository(db);
    const sandbox = new D1BillingRepository(db, "sandbox");
    expect(await prod.identity("owner")).toBe("existing-id");
    expect(await prod.state("owner")).toEqual(state());
    expect(await prod.beginSync("owner")).toBe(8);
    expect((await prod.catalog())?.revision).toBe(3);
    expect(await prod.eventProcessed("event")).toBe(true);
    expect(await sandbox.catalog()).toBeNull();
    expect(await sandbox.state("owner")).toBeNull();
    expect(await sandbox.eventProcessed("event")).toBe(false);
    expect(await sandbox.identity("owner")).not.toBe("existing-id");
    expect(
      await new D1MembershipRepository(db).activeGrant("owner", now),
    ).toMatchObject({ planId: "pro" });
    expect(
      await new D1MembershipRepository(db, "sandbox").activeGrant("owner", now),
    ).toBeNull();
    expect(
      await new D1MembershipRepository(db).countUsage("owner", "ai", "2026-09"),
    ).toBe(1);
    expect(
      await new D1MembershipRepository(db, "sandbox").countUsage(
        "owner",
        "ai",
        "2026-09",
      ),
    ).toBe(0);
  });

  it("isolates identities, catalog CAS, generations and deduplication for the same subject", async () => {
    const db = database();
    const prod = new D1BillingRepository(db);
    const sandbox = new D1BillingRepository(db, "sandbox");
    const [p, s] = await Promise.all([
      prod.identity("owner"),
      sandbox.identity("owner"),
    ]);
    expect(p).not.toBe(s);
    expect(await new D1BillingRepository(db, "sandbox").identity("owner")).toBe(
      s,
    );
    expect(await prod.owner(s)).toBeNull();
    expect(await sandbox.owner(p)).toBeNull();
    expect(
      await Promise.all([
        prod.replaceCatalog(catalog, 0),
        sandbox.replaceCatalog(catalog, 0),
      ]),
    ).toEqual([true, true]);
    expect(
      await Promise.all([
        sandbox.replaceCatalog(catalog, 1),
        sandbox.replaceCatalog(catalog, 1),
      ]),
    ).toEqual([true, false]);
    expect((await prod.catalog())?.revision).toBe(1);
    const pg = await prod.beginSync("owner");
    const sg = await sandbox.beginSync("owner");
    await sandbox.beginSync("owner");
    expect(await sandbox.commitSync("owner", sg, state(true))).toBe(false);
    expect(await prod.commitSync("owner", pg, state())).toBe(true);
    expect(await sandbox.commitSync("owner", sg + 1, state(true))).toBe(true);
    expect(await prod.state("owner")).toEqual(state());
    expect(await sandbox.state("owner")).toEqual(state(true));
    await sandbox.markEventProcessed("same-event");
    expect(await prod.eventProcessed("same-event")).toBe(false);
    await prod.markEventProcessed("same-event");
    expect(await sandbox.eventProcessed("same-event")).toBe(true);
  });

  it("isolates grant upserts, atomic quota admission and release", async () => {
    const db = database();
    const prod = new D1MembershipRepository(db);
    const sandbox = new D1MembershipRepository(db, "sandbox");
    const grant = {
      id: "g",
      ownerSub: "owner",
      planId: "pro",
      source: "admin" as const,
      startsAt: now,
      endsAt: null,
      createdAt: now,
    };
    await prod.putGrant(grant);
    await sandbox.putGrant({ ...grant, planId: "studio" });
    await sandbox.putGrant({ ...grant, planId: "retired" });
    expect((await prod.activeGrant("owner", now))?.planId).toBe("pro");
    expect((await sandbox.activeGrant("owner", now))?.planId).toBe("retired");
    const input = {
      ownerSub: "owner",
      capability: "ai",
      periodKey: "2026-09",
      itemKey: "same",
      limit: 1,
      createdAt: now,
    };
    expect((await prod.claimUniqueUsage(input)).created).toBe(true);
    expect((await sandbox.claimUniqueUsage(input)).created).toBe(true);
    expect((await sandbox.claimUniqueUsage(input)).created).toBe(false);
    expect(
      (await sandbox.claimUniqueUsage({ ...input, itemKey: "next" })).allowed,
    ).toBe(false);
    await sandbox.releaseUsage("owner", "ai", "2026-09", "same");
    expect(await sandbox.countUsage("owner", "ai", "2026-09")).toBe(0);
    expect(await prod.countUsage("owner", "ai", "2026-09")).toBe(1);
    const race = await Promise.all(
      ["a", "b"].map((itemKey) =>
        sandbox.claimUniqueUsage({ ...input, itemKey }),
      ),
    );
    expect(race.filter((r) => r.created)).toHaveLength(1);
  });

  it("never projects a sandbox transaction into production membership", async () => {
    const db = database();
    const repo = new D1BillingRepository(db);
    await new BillingService(
      repo,
      { subscriber: async () => state(true) },
      catalog,
    ).synchronize("owner");
    const service = new MembershipService(
      new BillingMembershipRepository(
        new D1MembershipRepository(db),
        repo,
        async () => catalog,
        false,
      ),
      { ...catalog, now: () => new Date(now) },
    );
    expect((await service.snapshot("owner")).isPaid).toBe(false);
  });

  it("authenticates webhooks and reconciles transfer ownership across environments regardless of URL", async () => {
    const db = database();
    const prod = new D1BillingRepository(db);
    const sandbox = new D1BillingRepository(db, "sandbox");
    const p = await prod.identity("owner");
    const s = await sandbox.identity("owner");
    let transferred = false;
    const calls: string[] = [];
    const provider = {
      subscriber: async (id: string) => {
        calls.push(id);
        return id === s
          ? state(true)
          : {
              ...state(),
              entitlements: transferred ? [] : state().entitlements,
            };
      },
    };
    const services = [prod, sandbox].map(
      (r) => new BillingService(r, provider, catalog),
    );
    await services[0]!.synchronize("owner");
    transferred = true;
    const app = new Hono();
    const route = createBilling({
      service: () => services[1]!,
      webhookServices: () => services,
      authenticate: async () => ({ sub: "owner", scopes: [] }),
      authorize: () => true,
      sdkKeys: () => ({ ios: "public", android: "public" }),
      webhookAuthorization: () => "secret",
    });
    app.route("/sandbox/billing", route);
    const body = JSON.stringify({
      event: {
        id: "transfer",
        type: "TRANSFER",
        transferred_from: [p],
        transferred_to: [s],
      },
    });
    const send = (authorization: string) =>
      app.request("/sandbox/billing/webhooks/revenuecat", {
        method: "POST",
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
        },
        body,
      });
    expect((await send("Bearer user-token")).status).toBe(401);
    expect((await send("secret")).status).toBe(204);
    expect((await prod.state("owner"))?.entitlements).toEqual([]);
    expect(await sandbox.state("owner")).toEqual(state(true));
    const count = calls.length;
    expect((await send("secret")).status).toBe(204);
    expect(calls).toHaveLength(count);
  });

  it("rejects opposite or mixed provider customers before overwriting a known snapshot", async () => {
    const db = database();
    const repo = new D1BillingRepository(db);
    await new BillingService(
      repo,
      { subscriber: async () => state() },
      catalog,
    ).synchronize("owner");
    for (const subscriptions of [
      {
        monthly: {
          is_sandbox: true,
          store: "app_store",
          unsubscribe_detected_at: null,
        },
      },
      {
        monthly: {
          is_sandbox: false,
          store: "app_store",
          unsubscribe_detected_at: null,
        },
        sandbox: {
          is_sandbox: true,
          store: "app_store",
          unsubscribe_detected_at: null,
        },
      },
    ]) {
      const request: typeof fetch = async () =>
        Response.json({
          request_date: now,
          subscriber: { management_url: null, entitlements: {}, subscriptions },
        });
      const service = new BillingService(
        repo,
        new RevenueCatProvider("fake", request, "production"),
        catalog,
      );
      await expect(service.synchronize("owner")).rejects.toMatchObject({
        code: "INVALID_PROVIDER_RESPONSE",
      });
      expect(await repo.state("owner")).toEqual(state());
    }
  });
});
