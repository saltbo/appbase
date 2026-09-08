import { expect, it } from "vitest";
import { createD1AdminServices } from "../src/adapters/d1_admin_composition.js";
import { revenueCatAdministration } from "../src/adapters/revenuecat_admin.js";
import { catalog, sqlite, state } from "./admin_support.js";
import { createAdmin } from "../src/http/admin.js";
import type { AdminPaymentProvider } from "../src/usecases/admin_payments.js";

// Covers: S_ADMIN_PAYMENT_WORKSPACE case=contract
it("shows provider-classified access and isolates bounded event receipts", async () => {
  const database = sqlite();
  const rc = revenueCatAdministration({
    apiKeyConfigured: true,
    webhookAuthorizationConfigured: false,
    iosSdkConfigured: true,
    androidSdkConfigured: false,
  });
  const create = (
    environment: "production" | "sandbox",
    provider: AdminPaymentProvider = rc,
  ) =>
    createD1AdminServices(
      database.db,
      environment,
      { subscriber: async () => state },
      catalog,
      () => new Date("2026-09-07"),
      {},
      provider,
    );
  const production = create("production");
  await production.billing.repository.identity("customer");
  const generation = await production.billing.repository.beginSync("customer");
  await production.billing.repository.commitSync("customer", generation, {
    ...state,
    entitlements: [
      state.entitlements[0]!,
      {
        ...state.entitlements[0]!,
        id: "gift",
        store: "promotional",
        willRenew: false,
      },
      {
        ...state.entitlements[0]!,
        id: "expired",
        expiresAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  });
  expect((await production.admin.user("customer")).access).toEqual([
    { entitlementId: "paid", kind: "purchased", status: "active" },
    { entitlementId: "gift", kind: "complimentary", status: "active" },
    { entitlementId: "expired", kind: "purchased", status: "expired" },
  ]);
  await production.billing.repository.markEventProcessed("production-one");
  await production.billing.repository.markEventProcessed("production-two");
  await create("sandbox").billing.repository.markEventProcessed("sandbox-only");
  const first = await production.admin.events(1, 1);
  const second = await production.admin.events(2, 1);
  expect(first.totalItems).toBe(2);
  expect(first.totalPages).toBe(2);
  expect(new Set([...first.items, ...second.items].map((e) => e.id))).toEqual(
    new Set(["production-one", "production-two"]),
  );
  expect(
    (await create("sandbox").admin.events(1, 20)).items.map((e) => e.id),
  ).toEqual(["sandbox-only"]);
  const alternate = create("production", {
    configuration: {
      providerId: "fixture-payments",
      providerName: "Fixture Payments",
      dashboardUrl: null,
      webhookPath: null,
      settings: [],
    },
    accessKind: () => "unknown",
  });
  expect((await alternate.admin.user("customer")).access[0]!.kind).toBe(
    "unknown",
  );
  const app = createAdmin({
    environment: "production",
    url: "https://example.test/admin",
    productName: "Test",
    environments: [],
    service: () => alternate.admin,
    authenticate: async () => ({ sub: "admin", scopes: [] }),
    authorize: () => true,
  });
  expect(
    await (await app.request("https://example.test/context")).json(),
  ).toMatchObject({
    paymentProvider: { providerId: "fixture-payments" },
    canInspectEvents: true,
  });
  expect(
    (await app.request("https://example.test/events?pageSize=1000")).status,
  ).toBe(422);
});
