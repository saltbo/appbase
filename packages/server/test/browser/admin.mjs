import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright";
import { Hono } from "hono";
import {
  createAdmin,
  createAdminPage,
  D1AdminUserDirectory,
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
const db = { prepare, batch: async statements => Promise.all(statements.map(s => s.all())) };
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
const services = {};
for (const environment of ["production", "sandbox"]) {
  for(let i=0; i<25; i++) sql.prepare("INSERT INTO appbase_billing_accounts(environment,owner_sub,app_user_id) VALUES (?,?,?)").run(environment, environment + "-customer-" + String(i).padStart(2,"0"), environment + "-payment-" + i);
  const billing = new BillingService(new D1BillingRepository(db, environment), {subscriber: async () => { throw new Error("No network allowed"); }}, catalog);
  const underlying = new BillingMembershipRepository(new D1MembershipRepository(db, environment), billing.repository, async () => (await billing.catalog()).catalog, environment === "sandbox");
  const membership = new MembershipService(underlying, {...catalog, loadCatalog: async () => (await billing.catalog()).catalog});
  services[environment] = new AdminService(environment, new D1AdminUserDirectory(db,environment),membership,billing,underlying);
}
let allowed = true;
const environments = [{name:"production",url:"https://admin.example.test/admin/api"},{name:"sandbox",url:"https://admin.example.test/sandbox/admin/api"}];
const app = new Hono().route("/admin",createAdminPage({url:"https://admin.example.test/admin",productName:"Example Product",environments}));
for(const environment of environments) app.route(new URL(environment.url).pathname,createAdmin({environment:environment.name,serveUi:false,productName:"Example Product",url:environment.url,environments,service:()=>services[environment.name],authenticate:async()=>({sub:"operator",scopes:[]}),authorize:()=>allowed}));
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
  const requests = [];
  let delayProduction = false, releaseProduction, productionStarted;
  let delayWrite = false, releaseWrite, writeStarted;
  await page.route("https://admin.example.test/**", async (route) => {
    const r = route.request(); requests.push({url:r.url(),method:r.method()});
    if (delayProduction && r.url().includes("/admin/api/customers") && !r.url().includes("/sandbox/")) {
      productionStarted?.();
      await new Promise(resolve => { releaseProduction = resolve; });
    }
    const response = await app.fetch(
      new Request(r.url(), {
        method: r.method(),
        headers: r.headers(),
        ...(r.postData() ? { body: r.postData() } : {}),
      }),
    );
    if (delayWrite && r.method() === "PUT") {
      writeStarted?.();
      await new Promise(resolve => { releaseWrite = resolve; });
    }
    await route.fulfill({
      status: response.status,
      headers: { ...Object.fromEntries(response.headers), ...(response.headers.has("etag") ? {etag: "W/" + response.headers.get("etag")} : {}) },
      body: Buffer.from(await response.arrayBuffer()),
    });
  });
  // Covers: S_ADMIN_CUSTOMERS case=happy_path
  // Covers: S_ADMIN_SINGLE_PAGE case=happy_path
  // Covers: S_ADMIN_SINGLE_PAGE case=error_path
  await page.goto("https://admin.example.test/admin");
  await page.getByRole("heading", {name:"Customers",exact:true}).waitFor();
  await page.getByText("25 customers · Page 1 of 2").waitFor();
  await page.getByRole("button",{name:"Next",exact:true}).click();
  await page.getByRole("button",{name:"production-customer-24",exact:true}).waitFor();
  await page.getByLabel("Search customers").fill("customer-24");
  await page.getByRole("button",{name:"Search",exact:true}).click();
  await page.getByText("1 customers · Page 1 of 1").waitFor();
  await page.getByRole("button",{name:"production-customer-24",exact:true}).click();
  await page.getByRole("heading", {name:"Customer details"}).waitFor();
  assert.equal(await page.getByRole("button",{name:"Grant membership"}).count(),0);
  await page.getByRole("button", {name:"Plans & quotas",exact:true}).click();
  await page.getByLabel("reader / ai limit (utc_month)").waitFor();
  assert.equal(await page.getByRole("status").textContent(), "");
  await page.getByLabel("reader / ai limit (utc_month)").fill("3");
  await page.getByLabel("Display name for reader").fill("Reader Essentials");
  await page.getByLabel("Type production to confirm").fill("production");
  await page.getByRole("button", {name:"Save catalog"}).click();
  await page.getByRole("status").filter({hasText:"Catalog saved"}).waitFor();
  assert.equal((await services.production.membership.snapshot("production-customer-24")).capabilities.ai.limit,3);
  assert.equal((await services.sandbox.membership.snapshot("sandbox-customer-24")).capabilities.ai.limit,2);
  // A save dispatched before a switch stays in its original environment.
  await page.getByLabel("reader / ai limit (utc_month)").fill("4");
  await page.getByLabel("Type production to confirm").fill("production");
  delayWrite = true;
  const writing = new Promise(resolve => {writeStarted=resolve;});
  await page.getByRole("button", {name:"Save catalog"}).click();
  await writing;
  await page.getByLabel("Environment",{exact:true}).selectOption("sandbox");
  await page.getByRole("button",{name:"sandbox-customer-00",exact:true}).waitFor();
  releaseWrite(); delayWrite = false;
  assert.equal((await services.production.membership.snapshot("production-customer-24")).capabilities.ai.limit,4);
  assert.equal((await services.sandbox.membership.snapshot("sandbox-customer-24")).capabilities.ai.limit,2);

  await page.getByRole("button", {name:"sandbox-customer-00",exact:true}).waitFor();
  assert.equal(page.url(),"https://admin.example.test/admin");
  assert(requests.some(r=>r.url.includes("/sandbox/admin/api/customers")));
  // A late production response must never replace sandbox content.
  delayProduction = true;
  const started = new Promise(resolve => {productionStarted=resolve;});
  await page.getByLabel("Environment",{exact:true}).selectOption("production");
  await started;
  await page.getByLabel("Environment",{exact:true}).selectOption("sandbox");
  await page.getByRole("button",{name:"sandbox-customer-00",exact:true}).waitFor();
  releaseProduction(); delayProduction=false;
  await page.getByRole("button",{name:"Customers",exact:true}).click();
  await page.getByRole("button",{name:"sandbox-customer-00",exact:true}).waitFor();
  assert.equal(await page.getByRole("button",{name:"production-customer-00",exact:true}).count(),0);
  await page.screenshot({path:"/tmp/appbase-admin-customers-desktop.png",fullPage:true});
  await page.setViewportSize({width:375,height:812});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:"/tmp/appbase-admin-customers-mobile.png",fullPage:true});
  allowed=false;
  await page.reload();
  await page.getByRole("status").filter({hasText:"do not have access"}).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Admin browser acceptance passed: pagination, search, details, fixed URL environment switch, stale reads/writes, proxy ETag, narrow layout and CSP.",
  );
} finally {
  await browser.close();
  sql.close();
}
