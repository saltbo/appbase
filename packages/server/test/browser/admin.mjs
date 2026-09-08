import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright";
import { Hono } from "hono";
import {
  createAdmin,
  AdminService,
  AdminMembershipRepository,
  D1AdminRepository,
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
const grants = new D1AdminRepository(db, "production");
const membership = new MembershipService(
  new AdminMembershipRepository(
    new BillingMembershipRepository(
      new D1MembershipRepository(db),
      billing.repository,
      async () => (await billing.catalog()).catalog,
      false,
    ),
    grants,
  ),
  { ...catalog, loadCatalog: async () => (await billing.catalog()).catalog },
);
const service = new AdminService(
  grants,
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
      headers: Object.fromEntries(response.headers),
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
  await page.getByText("No manual grants.", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Grant membership", exact: true })
    .click();
  await page.getByLabel("Override plan").selectOption("studio");
  await page
    .getByText("This overrides all active subscription benefits", {
      exact: false,
    })
    .waitFor();
  await page.getByLabel("Expires at (UTC)").fill("2099-01-01T00:00");
  await page.getByLabel("Reason", { exact: true }).fill("Browser acceptance");
  await page
    .getByLabel("Type production to confirm the override")
    .fill("sandbox");
  await page.getByRole("button", { name: "Confirm manual grant" }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "environment changed" })
    .waitFor();
  assert.equal(
    await page.getByLabel("Reason", { exact: true }).inputValue(),
    "Browser acceptance",
  );
  await page
    .getByLabel("Type production to confirm the override")
    .fill("production");
  await page.getByRole("button", { name: "Confirm manual grant" }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Manual grant created" })
    .waitFor();
  assert.equal((await membership.snapshot("customer-42")).planId, "studio");
  if (process.env.APPBASE_ADMIN_SCREENSHOT)
    await page.screenshot({
      path: process.env.APPBASE_ADMIN_SCREENSHOT,
      fullPage: true,
    });
  await page.getByRole("button", { name: "Revoke grant", exact: true }).click();
  await page.getByLabel("Revocation reason").fill("Acceptance complete");
  await page.getByLabel("Type production to confirm").fill("production");
  await page.getByRole("button", { name: "Confirm revocation" }).click();
  await page.getByRole("status").filter({ hasText: "Grant revoked" }).waitFor();
  assert.equal((await membership.snapshot("customer-42")).planId, "reader");
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
    "Admin browser acceptance passed: lookup, empty/error states, preview, environment confirmation, grant, revoke, catalog, narrow layout, CSP.",
  );
} finally {
  await browser.close();
  sql.close();
}
