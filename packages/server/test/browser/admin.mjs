import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright";
import { Hono } from "hono";
import {
  createAdmin,
  AdminService,
} from "../../dist/admin.js";
import {
  BillingService,
  BillingMembershipRepository,
} from "../../dist/billing.js";
import {
  D1BillingRepository,
  D1MembershipRepository,
} from "../../dist/cloudflare.js";
import { MembershipService } from "../../dist/membership.js";

// Covers: S_ADMIN_UI case=happy_path
// Covers: S_ADMIN_UI case=error_path
// Native browser/CSP against the actual Hono module and SQLite. No live services.
const sql = new DatabaseSync(":memory:");
for (const name of [
  "0001_appbase.sql",
  "0003_billing.sql",
  "0004_billing_environments.sql",
  "0005_admin.sql",
    "0006_revenuecat_grants.sql",
])
  sql.exec(
    readFileSync(new URL("../../migrations/" + name, import.meta.url), "utf8"),
  );
const prepare = (query, args = []) => ({
  bind: (...values) => prepare(query, values),
  first: async () => sql.prepare(query).get(...args) ?? null,
  all: async () => ({ results: sql.prepare(query).all(...args) }),
  run: async () => ({
    success: true,
    meta: { changes: Number(sql.prepare(query).run(...args).changes) },
  }),
});
const db = { prepare };
const catalog = {
  freePlan: {
    id: "reader",
    capabilities: { ai: { limit: 2, period: "utc_month" } },
  },
  plans: [
    { id: "studio", capabilities: { ai: { limit: 100, period: "utc_month" } } },
  ],
  entitlementPlans: { premium: "studio" },
  honorGracePeriod: true,
};
const billing = new BillingService(
  new D1BillingRepository(db),
  {
    subscriber: async () => {
      throw new Error("No network allowed");
    },
  },
  catalog,
);
const membership = new MembershipService(
    new BillingMembershipRepository(
      new D1MembershipRepository(db),
      billing.repository,
      async () => (await billing.catalog()).catalog,
      false,
    ),
  { ...catalog, loadCatalog: async () => (await billing.catalog()).catalog },
);
const service = new AdminService(
  "production",
  { find: async (q) => (q === "customer-42" ? { ownerSub: q } : null) },
  membership,
  billing,
  new D1MembershipRepository(db),
);
let allowed = true;
const app = new Hono().route(
  "/admin",
  createAdmin({
    environment: "production",
    productName: "Example Product",
    url: "https://admin.example.test/admin",
    environments: [
      { name: "Production", url: "https://admin.example.test/admin/" },
      { name: "Sandbox", url: "https://admin.example.test/sandbox/admin/" },
    ],
    service: () => service,
    authenticate: async () => ({ sub: "operator", scopes: [] }),
    authorize: () => allowed,
  }),
);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.APPBASE_CHROME_PATH
    ? { executablePath: process.env.APPBASE_CHROME_PATH }
    : {}),
});
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.error(e.message);
  });
  page.on("console", (m) => {
    if (m.type() === "error") console.error(m.text());
  });
  await page.route("https://admin.example.test/**", async (route) => {
    const r = route.request();
    const response = await app.fetch(
      new Request(r.url(), {
        method: r.method(),
        headers: r.headers(),
        ...(r.postData() ? { body: r.postData() } : {}),
      }),
    );
    await route.fulfill({
      status: response.status,
      headers: { ...Object.fromEntries(response.headers), ...(response.headers.has("etag") ? {etag: "W/" + response.headers.get("etag")} : {}) },
      body: Buffer.from(await response.arrayBuffer()),
    });
  });
  await page.goto("https://admin.example.test/admin/");
  await page.getByRole("heading", { name: "Find a user" }).waitFor();
  await page.getByLabel("Subject or payment identity").fill("unknown");
  await page.getByRole("button", { name: "Find user", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "No known user" }).waitFor();
  await page.getByLabel("Subject or payment identity").fill("customer-42");
  await page.getByRole("button", { name: "Find user", exact: true }).click();
  await page.getByText("Complimentary access is managed in RevenueCat", {exact: false}).waitFor();
  assert.equal(await page.getByRole("button", {name: "Grant membership", exact: true}).count(), 0);
  await page.getByRole("button", { name: "Back to search" }).click();
  await page.getByRole("button", { name: "Manage plans and quotas" }).click();
  await page.getByLabel("reader / ai limit (utc_month)").fill("3");
  await page.getByLabel("Display name for reader").fill("Reader Essentials");
  await page.getByLabel("Type production to confirm").fill("production");
  await page.getByRole("button", { name: "Save catalog" }).click();
  await page.getByRole("status").filter({ hasText: "Catalog saved" }).waitFor();
  assert.equal(
    (await membership.snapshot("customer-42")).capabilities.ai.limit,
    3,
  );
  assert.equal(
    (await membership.snapshot("customer-42")).displayName,
    "Reader Essentials",
  );
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  allowed = false;
  await page.reload();
  await page
    .getByRole("status")
    .filter({ hasText: "do not have permission" })
    .waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Admin browser acceptance passed: lookup, empty/error states, provider-owned membership, catalog with proxy-weakened ETag, narrow layout, CSP.",
  );
} finally {
  await browser.close();
  sql.close();
}
