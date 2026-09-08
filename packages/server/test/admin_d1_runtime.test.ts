import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { unstable_splitSqlQuery } from "wrangler";
import { createD1AdminServices } from "../src/adapters/d1_admin_composition.js";
import { D1BillingRepository } from "../src/adapters/d1_billing_repository.js";
import { D1MembershipRepository } from "../src/adapters/d1_membership_repository.js";
import { catalog, state } from "./admin_support.js";

// Covers: S_ADMIN_D1_RUNTIME case=happy_path
// Covers: S_ADMIN_D1_RUNTIME case=error_path
const runtime = new Miniflare({
  workers: [
    {
      config: {
        name: "fixture",
        type: "worker",
        compatibilityDate: "2026-07-12",
        manifest: {
          mainModule: "index.js",
          modulesRoot: "/",
          modules: {
            "index.js": {
              type: "esm",
              contents:
                "export default {fetch() {return new Response('fixture')}}",
            },
          },
        },
        env: { DB: { type: "d1", id: "admin-runtime" } },
      },
    },
  ],
});
let db: Awaited<ReturnType<typeof runtime.getD1Database>>;
beforeAll(async () => {
  db = await runtime.getD1Database("DB", "fixture");
  for (const migration of [
    "0001_appbase.sql",
    "0003_billing.sql",
    "0004_billing_environments.sql",
    "0005_admin.sql",
    "0006_revenuecat_grants.sql",
  ]) {
    const sql = readFileSync(
      new URL("../migrations/" + migration, import.meta.url),
      "utf8",
    );
    await db.batch(
      unstable_splitSqlQuery(sql).map((statement) => db.prepare(statement)),
    );
  }
});
afterAll(() => runtime.dispose());

describe("actual Workerd D1 administration", () => {
  it("happy_path counts trigger changes without misreporting successful CAS writes", async () => {
    const owner = crypto.randomUUID();
    const billing = new D1BillingRepository(db, "production");
    await billing.identity(owner);
    const generation = await billing.beginSync(owner);
    const applied = await db
      .prepare(
        "UPDATE appbase_billing_accounts SET state_json=? WHERE environment='production' AND owner_sub=? AND generation=?",
      )
      .bind(JSON.stringify(state), owner, generation)
      .run();
    expect(applied.meta.changes).toBe(1);
    expect(await billing.commitSync(owner, generation, state)).toBe(true);
    const stale = await db
      .prepare(
        "UPDATE appbase_billing_accounts SET state_json=? WHERE environment='production' AND owner_sub=? AND generation=?",
      )
      .bind(JSON.stringify(state), owner, generation - 1)
      .run();
    expect(stale.meta.changes).toBe(0);
    expect(await billing.commitSync(owner, generation - 1, state)).toBe(false);
    expect(await billing.replaceCatalog(catalog, 0)).toBe(true);
    expect(await billing.replaceCatalog(catalog, 0)).toBe(false);
    expect(await billing.replaceCatalog(catalog, 1)).toBe(true);
    const membership = new D1MembershipRepository(db);
    const claim = {
      ownerSub: owner,
      capability: "ai",
      periodKey: "fixture",
      itemKey: "one",
      limit: 1,
      createdAt: new Date().toISOString(),
    };
    expect(await membership.claimUniqueUsage(claim)).toMatchObject({
      allowed: true,
      created: true,
      used: 1,
    });
    expect(await membership.claimUniqueUsage(claim)).toMatchObject({
      allowed: true,
      created: false,
      used: 1,
    });
    expect(
      await membership.claimUniqueUsage({ ...claim, itemKey: "two" }),
    ).toMatchObject({ allowed: false, created: false });
  });

  it("reads isolated provider membership with no manual grant service", async () => {
    const owner = crypto.randomUUID();
    const p = createD1AdminServices(
      db,
      "production",
      { subscriber: async () => state },
      catalog,
      () => new Date("2026-09-07T00:00:00.000Z"),
    );
    const s = createD1AdminServices(
      db,
      "sandbox",
      { subscriber: async () => ({ ...state, entitlements: [] }) },
      catalog,
    );
    await p.billing.synchronize(owner);
    await s.billing.synchronize(owner);
    expect((await p.admin.user(owner)).membership.planId).toBe("studio");
    expect((await s.admin.user(owner)).membership.planId).toBe("starter");
    // Covers: S_ADMIN_CUSTOMERS case=contract
    const production = await p.admin.customers({
      page: 1,
      pageSize: 20,
      query: owner,
    });
    const sandbox = await s.admin.customers({
      page: 1,
      pageSize: 20,
      query: owner,
    });
    expect(production.items).toHaveLength(1);
    expect(production.items[0]).toMatchObject({
      ownerSub: owner,
      isPaid: true,
      planId: "studio",
    });
    expect(sandbox.items[0]).toMatchObject({
      ownerSub: owner,
      isPaid: false,
      planId: "starter",
    });
    expect(production.items[0]!.appUserId).not.toBe(
      sandbox.items[0]!.appUserId,
    );
    expect(p.admin).not.toHaveProperty("create");
  });
});
