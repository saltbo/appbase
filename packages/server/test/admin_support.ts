import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import { BillingService } from "../src/usecases/billing.js";
import { D1BillingRepository } from "../src/adapters/d1_billing_repository.js";
import { D1MembershipRepository } from "../src/adapters/d1_membership_repository.js";
import { BillingMembershipRepository } from "../src/usecases/billing_membership_repository.js";
import { AdminMembershipRepository } from "../src/usecases/admin_membership_repository.js";
import { AdminService, type AdminEnvironment } from "../src/usecases/admin.js";
import { D1AdminRepository } from "../src/adapters/d1_admin_repository.js";
import { MembershipService } from "../src/usecases/membership.js";
import type { BillingCatalog, BillingState } from "../src/domain/billing.js";
export function sqlite() {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of [
    "0001_appbase.sql",
    "0003_billing.sql",
    "0004_billing_environments.sql",
    "0005_admin.sql",
  ])
    sqlite.exec(
      readFileSync(new URL("../migrations/" + name, import.meta.url), "utf8"),
    );
  const prepare = (
    sql: string,
    args: SQLInputValue[] = [],
  ): D1PreparedStatement =>
    ({
      bind: (...values: SQLInputValue[]) => prepare(sql, values),
      first: async () => sqlite.prepare(sql).get(...args) ?? null,
      all: async () => ({
        success: true,
        results: sqlite.prepare(sql).all(...args),
      }),
      run: async () => ({
        success: true,
        meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) },
      }),
    }) as D1PreparedStatement;
  return { sqlite, db: { prepare } as D1Database };
}
export const catalog: BillingCatalog = {
  freePlan: {
    id: "starter",
    capabilities: { ai: { limit: 2, period: "utc_month" } },
  },
  plans: [
    { id: "studio", capabilities: { ai: { limit: 100, period: "utc_month" } } },
    { id: "team", capabilities: { ai: { limit: 1000, period: "utc_month" } } },
  ],
  entitlementPlans: { paid: "studio" },
  honorGracePeriod: true,
};
export const state: BillingState = {
  observedAt: "2026-09-07T00:00:00.000Z",
  managementUrl: "https://private.example/manage",
  entitlements: [
    {
      id: "paid",
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
export function setup(
  environment: AdminEnvironment = "production",
  database = sqlite(),
) {
  let now = new Date("2026-09-07T00:00:00.000Z");
  const billing = new BillingService(
    new D1BillingRepository(database.db, environment),
    { subscriber: async () => state },
    catalog,
  );
  const grants = new D1AdminRepository(database.db, environment);
  const underlying = new BillingMembershipRepository(
    new D1MembershipRepository(database.db, environment),
    billing.repository,
    async () => (await billing.catalog()).catalog,
    environment === "sandbox",
  );
  const repository = new AdminMembershipRepository(underlying, grants);
  const membership = new MembershipService(repository, {
    ...catalog,
    loadCatalog: async () => (await billing.catalog()).catalog,
    now: () => now,
  });
  const service = new AdminService(
    grants,
    { find: async (q) => (q === "user" ? { ownerSub: "user" } : null) },
    membership,
    billing,
    underlying,
    () => now,
  );
  return {
    ...database,
    billing,
    grants,
    underlying,
    repository,
    membership,
    service,
    setNow: (value: string) => {
      now = new Date(value);
    },
  };
}
