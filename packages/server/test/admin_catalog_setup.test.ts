import { describe, it, expect } from "vitest";
import { sqlite } from "./admin_support.js";
import { createD1AdminServices } from "../src/adapters/d1_admin_composition.js";
import { createAdmin } from "../src/http/admin.js";
import type { BillingSchema, BillingCatalog } from "../src/domain/billing.js";

const schema: BillingSchema = {
  capabilities: {
    exports: {
      type: "quota",
      displayName: "Exports",
      description: "Export allowance",
      unit: "exports",
      period: "utc_month",
    },
  },
};
const catalog: BillingCatalog = {
  freePlan: {
    id: "starter",
    displayName: "Starter",
    capabilities: { exports: { limit: 3, period: "utc_month" } },
  },
  plans: [],
  entitlementPlans: {},
  honorGracePeriod: false,
};
const provider = {
  subscriber: async () => {
    throw new Error("No external calls");
  },
};
const paid = {
  id: "extra",
  capabilities: { exports: { limit: 10, period: "utc_month" as const } },
};
// Covers: S_ADMIN_CATALOG_SETUP case=happy_path
// Covers: S_ADMIN_CATALOG_SETUP case=error_path
// Covers: S_ADMIN_PLAN_DELETE case=happy_path
// Covers: S_ADMIN_PLAN_DELETE case=error_path
// Covers: S_ADMIN_PLAN_DELETE case=contract
describe("schema-owned catalog lifecycle", () => {
  it("starts unconfigured and initializes only the selected environment", async () => {
    const database = sqlite();
    const services = createD1AdminServices(
      database.db,
      "sandbox",
      provider,
      schema,
    );
    await expect(services.billing.catalog()).rejects.toMatchObject({
      code: "CONFIGURATION_MISSING",
    });
    await expect(services.membership.snapshot("unknown")).rejects.toMatchObject(
      { code: "CONFIGURATION_MISSING" },
    );
    const app = createAdmin({
      environment: "sandbox",
      productName: "Export app",
      url: "https://example.test/admin",
      environments: [],
      service: () => services.admin,
      authenticate: async () => ({ sub: "admin", scopes: [] }),
      authorize: () => true,
    });
    const context = (await (
      await app.request("https://example.test/context")
    ).json()) as { catalogInitialized: boolean; benefitSchema: unknown };
    expect(context.catalogInitialized).toBe(false);
    expect(context.benefitSchema).toEqual(schema.capabilities);
    const empty = await app.request("https://example.test/catalog");
    expect(await empty.json()).toBeNull();
    expect(empty.headers.get("AppBase-Catalog-Revision")).toBe("0");
    const save = await app.request("https://example.test/catalog", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://example.test",
        "If-Match": '"0"',
        "Admin-Environment": "sandbox",
      },
      body: JSON.stringify(catalog),
    });
    expect(save.status).toBe(200);
    await expect(
      services.billing.replaceCatalog(catalog, 0),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const fresh = createD1AdminServices(
      database.db,
      "sandbox",
      provider,
      schema,
    );
    expect(
      (await fresh.membership.snapshot("user")).capabilities.exports!.limit,
    ).toBe(3);
    expect(
      await createD1AdminServices(
        database.db,
        "production",
        provider,
        schema,
      ).billing.administrationCatalog(),
    ).toBeNull();
    const invented = structuredClone(catalog);
    invented.freePlan.capabilities = {
      other: { limit: 1, period: "utc_month" },
    };
    await expect(
      fresh.billing.replaceCatalog(invented, 1),
    ).rejects.toMatchObject({ code: "INVALID_CATALOG" });
  });
  it("deletes an unreferenced plan but retains defaults, bindings and historical grants", async () => {
    const database = sqlite();
    const { billing } = createD1AdminServices(
      database.db,
      "production",
      provider,
      schema,
    );
    await billing.replaceCatalog({ ...catalog, plans: [paid] }, 0);
    await billing.replaceCatalog(catalog, 1);
    expect((await billing.catalog()).catalog.plans).toEqual([]);
    await expect(
      billing.replaceCatalog(
        { ...catalog, freePlan: { ...catalog.freePlan, id: "renamed" } },
        2,
      ),
    ).rejects.toMatchObject({ code: "INVALID_CATALOG" });
    await billing.replaceCatalog(
      { ...catalog, plans: [paid], entitlementPlans: { paid: "extra" } },
      2,
    );
    await expect(billing.replaceCatalog(catalog, 3)).rejects.toMatchObject({
      code: "INVALID_CATALOG",
    });
    // A distinct unbound plan gets a historical grant after the operator has read the revision.
    const extra = { ...paid, id: "historic" };
    await billing.replaceCatalog(
      { ...catalog, plans: [paid, extra], entitlementPlans: { paid: "extra" } },
      3,
    );
    database.sqlite
      .prepare(
        "INSERT INTO appbase_membership_grants(environment,id,owner_sub,plan_id,source,starts_at,created_at) VALUES ('production','old','user','historic','legacy','2020','2020')",
      )
      .run();
    await expect(
      billing.replaceCatalog(
        { ...catalog, plans: [paid], entitlementPlans: { paid: "extra" } },
        4,
      ),
    ).rejects.toThrow("historical membership");
    expect((await billing.catalog()).revision).toBe(4);
  });
});
