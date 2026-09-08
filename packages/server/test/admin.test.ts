import { describe, it, expect } from "vitest";
import { setup, catalog, sqlite } from "./admin_support.js";
import { createAdmin } from "../src/http/admin.js";
import { AuthenticationError } from "../src/usecases/ports.js";
import { D1AdminUserDirectory } from "../src/adapters/d1_admin_users.js";
import { D1AdminSessionStore } from "../src/adapters/d1_admin_sessions.js";
import { adminOpenApi } from "../src/http/admin_contract.js";
import contract from "../../../protocol/admin.openapi.json" with { type: "json" };
import fixture from "../../../protocol/fixtures/admin-contract.json" with { type: "json" };

const id = "00000000-0000-4000-8000-000000000001";
const second = "00000000-0000-4000-8000-000000000002";
const input = async (
  s: ReturnType<typeof setup>,
  planId = "team",
  grantId = id,
) => ({
  id: grantId,
  ownerSub: "user",
  planId,
  endsAt: "2026-09-10T00:00:00.000Z",
  reason: "Support case 42",
  expectedMembership: await s.membership.snapshot("user"),
  expectedCatalogRevision: (await s.billing.catalog()).revision,
});
describe("manual membership", () => {
  // Covers: S_ADMIN_GRANTS case=happy_path
  it("temporarily overrides paid membership, including a lower plan, without changing billing state", async () => {
    const s = setup();
    await s.billing.synchronize("user");
    const before = await s.billing.repository.state("user");
    const created = await s.service.create(
      await input(s, "starter"),
      "operator",
    );
    expect(created).toMatchObject({
      source: "manual",
      createdBy: "operator",
      reason: "Support case 42",
      environment: "production",
    });
    expect((await s.membership.snapshot("user")).planId).toBe("starter");
    s.setNow("2026-09-10T00:00:00.000Z");
    expect((await s.membership.snapshot("user")).planId).toBe("studio");
    expect(await s.billing.repository.state("user")).toEqual(before);
  });
  it("orders simultaneous grants by id and preserves revocation audit", async () => {
    const s = setup();
    await s.billing.synchronize("user");
    await s.service.create(await input(s, "team"), "operator");
    await s.service.create(await input(s, "starter", second), "operator2");
    expect((await s.membership.snapshot("user")).planId).toBe("starter");
    await s.service.revoke(second, "Incorrect plan", "reviewer");
    expect((await s.membership.snapshot("user")).planId).toBe("team");
    await s.service.revoke(id, "Finished", "reviewer");
    expect((await s.membership.snapshot("user")).planId).toBe("studio");
    expect((await s.grants.get(second))?.revocation).toMatchObject({
      createdBy: "reviewer",
      reason: "Incorrect plan",
    });
    await expect(
      s.service.revoke(second, "again", "reviewer"),
    ).rejects.toMatchObject({ status: 409 });
    expect((await s.grants.list("user")).map((g) => g.id)).toEqual([
      second,
      id,
    ]);
    expect((await s.grants.list("user", second)).map((g) => g.id)).toEqual([
      id,
    ]);
  });
  // Covers: S_ADMIN_GRANTS case=error_path
  it("rejects invalid plans, stale previews, duplicate ids, expired grants and unknown users", async () => {
    const s = setup();
    const original = await input(s);
    await expect(
      s.service.create({ ...original, planId: "invented" }, "op"),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      s.service.create(
        { ...original, endsAt: "2026-09-01T00:00:00.000Z" },
        "op",
      ),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      s.service.create({ ...original, ownerSub: "unknown" }, "op"),
    ).rejects.toMatchObject({ status: 404 });
    await s.service.create(original, "op");
    await expect(
      s.service.create({ ...original, id: second }, "op"),
    ).rejects.toMatchObject({ status: 409 });
    await expect(s.service.create(await input(s), "op")).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      s.service.revoke(second, "reason", "op"),
    ).rejects.toMatchObject({ status: 404 });
  });
  // Covers: S_ADMIN_ENVIRONMENT case=contract
  it("binds manual storage to one environment and forwards usage to the composed repository", async () => {
    const production = setup(),
      sandbox = setup("sandbox", production);
    const grant = await production.service.create(
      await input(production),
      "op",
    );
    expect((await sandbox.membership.snapshot("user")).planId).toBe("starter");
    expect(await sandbox.grants.get(id)).toBeNull();
    expect(
      await sandbox.grants.revoke(id, {
        createdAt: grant.createdAt,
        createdBy: "op",
        reason: "test",
      }),
    ).toBe(false);
    await expect(sandbox.grants.create(grant)).rejects.toThrow("environment");
    await sandbox.repository.claimUniqueUsage({
      ownerSub: "user",
      capability: "ai",
      periodKey: "2026-09",
      itemKey: "private-item",
      limit: 2,
      createdAt: grant.createdAt,
    });
    expect(await sandbox.repository.countUsage("user", "ai", "2026-09")).toBe(
      1,
    );
    await sandbox.repository.releaseUsage(
      "user",
      "ai",
      "2026-09",
      "private-item",
    );
    expect(await sandbox.repository.countUsage("user", "ai", "2026-09")).toBe(
      0,
    );
  });
});
function http(s = setup()) {
  const app = createAdmin({
    environment: "production",
    productName: "Example Product",
    url: "https://example.test/admin",
    environments: [
      { name: "Sandbox", url: "https://example.test/sandbox/admin/" },
    ],
    service: () => s.service,
    authenticate: async (r) => {
      const scopes = r.headers.get("Authorization");
      if (!scopes) throw new AuthenticationError();
      return { sub: "operator", scopes: scopes.split(" ") };
    },
    authorize: (p, scope) => p.scopes.includes(scope),
  });
  const request = (
    path: string,
    method = "GET",
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    app.request("https://example.test" + path, {
      method,
      headers: {
        Authorization: "admin:read admin:grants:write billing:configure",
        Origin: "https://example.test",
        "Content-Type": "application/json",
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { ...s, request };
}
describe("admin HTTP and privacy", () => {
  it("publishes its optional contract and accepts the independent grant fixture", async () => {
    expect(adminOpenApi).toEqual(contract);
    const s = http();
    expect(
      (await s.request("/manual-grants", "POST", fixture.createGrant)).status,
    ).toBe(201);
    expect((await s.request("/unknown/")).status).toBe(404);
  });
  // Covers: S_ADMIN_ACCESS case=error_path
  it("requires independent read and write privileges, CSRF origin, and fixed environment", async () => {
    const s = http();
    const value = { ...(await input(s)), environment: "production" };
    for (const method of ["GET", "POST"]) {
      const r = await s.request(
        method === "GET" ? "/users?query=user" : "/manual-grants",
        method,
        method === "POST" ? value : undefined,
        { Authorization: "appbase:read appbase:write" },
      );
      expect(r.status).toBe(403);
    }
    expect(
      (await s.request("/context", "GET", undefined, { Authorization: "" }))
        .status,
    ).toBe(401);
    expect(
      (
        await s.request("/manual-grants", "POST", value, {
          Authorization: "admin:read",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await s.request("/manual-grants", "POST", value, {
          Origin: "https://evil.test",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await s.request("/manual-grants", "POST", {
          ...value,
          environment: "sandbox",
        })
      ).status,
    ).toBe(409);
    expect(await s.grants.list("user")).toEqual([]);
  });
  // Covers: S_ADMIN_UI case=happy_path
  // Covers: S_ADMIN_ENVIRONMENT case=error_path
  it("refreshes effective membership and audit history after grant/revocation", async () => {
    const s = http();
    await s.billing.synchronize("user");
    const response = await s.request("/manual-grants", "POST", {
      ...(await input(s)),
      environment: "production",
    });
    expect(response.status).toBe(201);
    expect(response.headers.get("Location")).toBe(
      "https://example.test/admin/manual-grants/" + id,
    );
    const user = await (await s.request("/users?query=user")).json();
    expect(user).toMatchObject({ membership: { planId: "team" } });
    expect(JSON.stringify(user)).not.toContain("managementUrl");
    expect((await s.request("/manual-grants/" + id)).status).toBe(200);
    expect((await s.request("/manual-grants/" + second)).status).toBe(404);
    expect(
      (
        await s.request("/manual-grants/" + id + "/revocation", "PUT", {
          reason: "Completed",
          environment: "production",
        })
      ).status,
    ).toBe(200);
    expect(await (await s.request("/users?query=user")).json()).toMatchObject({
      membership: { planId: "studio" },
    });
    expect((await s.request("/users?query=unknown")).status).toBe(404);
    expect((await s.request("/manual-grants", "POST", {})).status).toBe(422);
    expect(
      (await s.request("/manual-grants?ownerSub=user")).headers.get(
        "Cache-Control",
      ),
    ).toContain("no-store");
    const html = await s.request("/");
    expect(await html.text()).toContain("Example Product");
    expect(html.headers.get("Content-Security-Policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect((await s.request("/admin.js")).headers.get("Content-Type")).toBe(
      "text/javascript",
    );
    expect((await s.request("/admin.css")).status).toBe(200);
  });
  // Covers: S_ADMIN_CATALOG case=contract
  it("uses billing validation and ETag conflict protection for quota configuration", async () => {
    const s = http();
    const read = await s.request("/catalog");
    expect(read.headers.get("ETag")).toBe('"0"');
    const body = {
      ...catalog,
      plans: catalog.plans.map((p) => ({
        ...p,
        capabilities: { ai: { limit: 120, period: "utc_month" } },
      })),
    };
    const headers = { "If-Match": '"0"', "Admin-Environment": "production" };
    expect((await s.request("/catalog", "PUT", body, headers)).status).toBe(
      200,
    );
    expect((await s.request("/catalog", "PUT", body, headers)).status).toBe(
      412,
    );
    expect(
      (
        await s.request("/catalog", "PUT", body, {
          "Admin-Environment": "production",
        })
      ).status,
    ).toBe(428);
    expect(
      (
        await s.request("/catalog", "PUT", body, {
          ...headers,
          "If-Match": "bad",
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await s.request(
          "/catalog",
          "PUT",
          { ...body, freePlan: { ...body.freePlan, id: "changed" } },
          { ...headers, "If-Match": '"1"' },
        )
      ).status,
    ).toBe(422);
  });
});
describe("admin storage boundaries", () => {
  it("queries only operational identity fields under the agreed environment schema", async () => {
    const { db, sqlite: sql } = sqlite();
    // Contract fixture for the separately owned 0004 migration; no production compatibility fallback.
    sql.exec(
      "ALTER TABLE appbase_billing_accounts ADD COLUMN environment TEXT NOT NULL DEFAULT 'production'; ALTER TABLE appbase_membership_grants ADD COLUMN environment TEXT NOT NULL DEFAULT 'production'; INSERT INTO appbase_billing_accounts(owner_sub,app_user_id) VALUES ('user','payment-user');",
    );
    const directory = new D1AdminUserDirectory(db, "production");
    expect(await directory.find("payment-user")).toEqual({
      ownerSub: "user",
      appUserId: "payment-user",
    });
    expect(
      await new D1AdminUserDirectory(db, "sandbox").find("payment-user"),
    ).toBeNull();
    expect(await directory.find("missing")).toBeNull();
    sql.exec(
      "INSERT INTO appbase_records(owner_sub,collection,record_id,device_id,mutation_id,revision,payload_json,created_at) VALUES ('synced','private','secret','d','m','r','encrypted-private-value','now')",
    );
    expect(await directory.find("synced")).toEqual({ ownerSub: "synced" });
  });
  it("expires and deletes sessions without retaining OAuth tokens", async () => {
    const store = new D1AdminSessionStore(sqlite().db);
    const p = { sub: "op", scopes: ["admin:read"] };
    await store.put("hash", p, 100);
    expect(await store.get("hash", 99)).toEqual(p);
    expect(await store.get("hash", 100)).toBeNull();
    await store.delete("hash");
    expect(await store.get("hash", 0)).toBeNull();
  });
});
