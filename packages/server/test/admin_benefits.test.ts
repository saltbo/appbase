import { describe, expect, it } from "vitest";
import { createD1AdminServices } from "../src/adapters/d1_admin_composition.js";
import { sqlite, catalog } from "./admin_support.js";
import { createAdmin } from "../src/http/admin.js";
import type { AdminBenefitRegistry } from "../src/usecases/admin.js";

// Covers: S_ADMIN_BENEFIT_BOUNDARIES case=contract
describe("app-owned benefit semantics", () => {
  const baseline = structuredClone(catalog);
  for (const plan of [baseline.freePlan, ...baseline.plans])
    plan.capabilities = {
      ...plan.capabilities,
      sources: { limit: 1, period: "lifetime" },
    };
  const benefits: AdminBenefitRegistry = {
    ai: {
      displayName: "AI explanations",
      description: "Cloud requests",
      unit: "requests",
    },
    sources: {
      displayName: "Sources",
      description: "Device source count",
      unit: "sources",
    },
  };
  it("returns recorded usage without execution-location classification", async () => {
    const db = sqlite().db;
    const services = createD1AdminServices(
      db,
      "production",
      {
        subscriber: async () => {
          throw new Error("No provider call");
        },
      },
      baseline,
      () => new Date("2026-09-07"),
      benefits,
    );
    await services.billing.repository.identity("user");
    await services.membership.claimUnique("user", "ai", "first");
    const app = createAdmin({
      environment: "production",
      productName: "Test",
      url: "https://example.test/admin",
      environments: [],
      service: () => services.admin,
      authenticate: async () => ({ sub: "admin", scopes: [] }),
      authorize: () => true,
    });
    const response = await app.request("https://example.test/users?query=user");
    const user = (await response.json()) as {
      membership: { capabilities: Record<string, { used: number | null }> };
    };
    expect(user.membership.capabilities.ai!.used).toBe(1);
    expect(user.membership.capabilities.sources!.used).toBe(0);
    const updated = structuredClone(baseline);
    updated.freePlan.capabilities.sources!.limit = 4;
    await services.billing.replaceCatalog(updated, 0);
    const fresh = createD1AdminServices(
      db,
      "production",
      {
        subscriber: async () => {
          throw new Error("No provider call");
        },
      },
      baseline,
      () => new Date("2026-09-07"),
      benefits,
    );
    expect(
      (await fresh.membership.snapshot("user")).capabilities.sources!.limit,
    ).toBe(4);
    expect(fresh.admin.benefits.sources).not.toHaveProperty("enforcement");
    const invented = structuredClone(updated);
    invented.freePlan.capabilities = {
      ...invented.freePlan.capabilities,
      madeUp: { limit: 1, period: "lifetime" },
    };
    await expect(fresh.billing.replaceCatalog(invented, 1)).rejects.toThrow(
      "Capability names",
    );
  });
  it("rejects incomplete benefit metadata", () => {
    expect(() =>
      createD1AdminServices(
        sqlite().db,
        "production",
        {
          subscriber: async () => {
            throw new Error("unused");
          },
        },
        baseline,
        () => new Date(),
        { ai: benefits.ai! },
      ),
    ).toThrow("must match");
  });
});
