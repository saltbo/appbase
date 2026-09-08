import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
// Covers: S_ADMIN_D1_RUNTIME case=contract
import { describe, it, expect } from "vitest";
import { D1MembershipRepository } from "../src/adapters/d1_membership_repository.js";
import { setup, catalog, sqlite } from "./admin_support.js";
import { createAdmin } from "../src/http/admin.js";
import { AuthenticationError } from "../src/usecases/ports.js";
import { D1AdminUserDirectory } from "../src/adapters/d1_admin_users.js";
import { D1AdminSessionStore } from "../src/adapters/d1_admin_sessions.js";
import { createD1AdminServices } from "../src/adapters/d1_admin_composition.js";
import { adminOpenApi } from "../src/http/admin_contract.js";
import contract from "../../../protocol/admin.openapi.json" with { type: "json" };

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
describe("provider-owned membership administration", () => {
  // Covers: S_ADMIN_ACCESS case=error_path
  it("requires administrative access for reads and catalog writes", async () => {
    const s = http();
    expect(
      (
        await s.request("/users?query=user", "GET", undefined, {
          Authorization: "appbase:read",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await s.request("/catalog", "PUT", catalog, {
          Authorization: "admin:read",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await s.request("/catalog", "PUT", catalog, {
          Origin: "https://foreign.test",
        })
      ).status,
    ).toBe(403);
  });
  // Covers: S_ADMIN_UI case=contract
  it("serves its published contract and static UI without leaking credentials", async () => {
    expect(adminOpenApi).toEqual(contract);
    const s = http();
    for (const path of ["/", "/admin/", "/admin.js", "/admin.css"]) {
      const response = await s.request(path);
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toContain("no-store");
      expect(response.headers.get("Content-Security-Policy")).toContain(
        "frame-ancestors 'none'",
      );
    }
    expect(
      (
        await s.request("/users?query=user", "GET", undefined, {
          Authorization: "",
        })
      ).status,
    ).toBe(401);
    expect((await s.request("/users?query=missing")).status).toBe(404);
    expect((await s.request("/users?query=")).status).toBe(422);
    expect(
      (
        await s.request("/catalog", "PUT", catalog, {
          "Admin-Environment": "sandbox",
          "If-Match": '"0"',
        })
      ).status,
    ).toBe(409);
  });
  it("preserves previously issued legacy membership and default plans", async () => {
    const s = setup();
    expect((await s.service.user("user")).source).toBe("default");
    await new D1MembershipRepository(s.db).putGrant({
      id: "legacy",
      ownerSub: "user",
      planId: "team",
      source: "admin",
      startsAt: "2026-09-01T00:00:00.000Z",
      endsAt: null,
      createdAt: "2026-09-01T00:00:00.000Z",
    });
    expect((await s.service.user("user")).source).toBe("legacy");
    expect((await s.service.user("user")).membership.planId).toBe("team");
    const sandbox = setup("sandbox", s);
    expect((await sandbox.service.user("user")).membership.planId).toBe(
      "starter",
    );
  });
  // Covers: S_ADMIN_PROVIDER_OWNERSHIP case=contract
  it("removes manual grant APIs and reads RevenueCat membership without overrides", async () => {
    const s = http();
    await s.billing.synchronize("user");
    expect((await s.service.user("user")).membership.planId).toBe("studio");
    expect((await s.service.user("user")).source).toBe("subscription");
    await expect(s.service.user("missing")).rejects.toMatchObject({
      status: 404,
    });
    for (const [method, path] of [
      ["GET", "/manual-grants?ownerSub=user"],
      ["POST", "/manual-grants"],
      ["PUT", "/manual-grants/id/revocation"],
    ]) {
      expect((await s.request(path!, method!)).status).toBe(404);
    }
    expect(await (await s.request("/context")).json()).not.toHaveProperty(
      "canGrant",
    );
  });
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
describe("manual grant retirement", () => {
  it("refuses to delete existing grants and retires an empty store", () => {
    const sql = new DatabaseSync(":memory:");
    for (const name of [
      "0001_appbase.sql",
      "0003_billing.sql",
      "0004_billing_environments.sql",
      "0005_admin.sql",
    ])
      sql.exec(
        readFileSync(new URL("../migrations/" + name, import.meta.url), "utf8"),
      );
    sql.exec(
      "INSERT INTO appbase_admin_grants(environment,id,owner_sub,plan_id,starts_at,ends_at,reason,created_by,created_at,previous_plan_id,catalog_revision) VALUES ('production','fixture','user','studio','2026-01-01','2027-01-01','fixture','operator','2026-01-01','starter',0)",
    );
    const migration = readFileSync(
      new URL("../migrations/0006_revenuecat_grants.sql", import.meta.url),
      "utf8",
    );
    sql.exec("BEGIN");
    expect(() => sql.exec(migration)).toThrow();
    sql.exec("ROLLBACK");
    expect(
      sql.prepare("SELECT COUNT(*) AS n FROM appbase_admin_grants").get()?.n,
    ).toBe(1);
    sql.exec("DELETE FROM appbase_admin_grants");
    sql.exec(migration);
    expect(
      sql
        .prepare(
          "SELECT name FROM sqlite_master WHERE name='appbase_admin_grants'",
        )
        .get(),
    ).toBeUndefined();
    sql.close();
  });
});
describe("admin storage boundaries", () => {
  // Covers: S_ADMIN_SESSION_RETENTION case=contract
  it("automatically drains bounded expired batches without deleting active authentication state", async () => {
    const { db, sqlite: sql } = sqlite();
    const store = new D1AdminSessionStore(db, () => 1000);
    const principal = { sub: "operator", scopes: ["admin:read"] };
    for (let i = 0; i < 250; i++) {
      sql
        .prepare("INSERT INTO appbase_admin_sessions VALUES (?,?,?)")
        .run("session-" + i, JSON.stringify(principal), i);
      sql
        .prepare("INSERT INTO appbase_admin_login_attempts VALUES (?,?)")
        .run("attempt-" + i, i);
    }
    sql
      .prepare("INSERT INTO appbase_admin_sessions VALUES (?,?,?)")
      .run("live", JSON.stringify(principal), 2000);
    sql
      .prepare("INSERT INTO appbase_admin_login_attempts VALUES (?,?)")
      .run("live", 2000);
    const count = (table: string) =>
      sql
        .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE expires_at<=1000`)
        .get()!.n;
    await store.startAttempt("new", 2000);
    expect(count("appbase_admin_sessions")).toBe(150);
    expect(count("appbase_admin_login_attempts")).toBe(150);
    expect(
      sql
        .prepare(
          "SELECT id_hash FROM appbase_admin_login_attempts WHERE id_hash='attempt-0'",
        )
        .get(),
    ).toBeUndefined();
    expect(await store.get("live", 1000)).toEqual(principal);
    expect(count("appbase_admin_sessions")).toBe(50);
    expect(count("appbase_admin_login_attempts")).toBe(50);
    expect(await store.consumeAttempt("live", 1000)).toBe(true);
    expect(count("appbase_admin_sessions")).toBe(0);
    expect(count("appbase_admin_login_attempts")).toBe(0);
    expect(await store.consumeAttempt("new", 1000)).toBe(true);
    expect(await store.get("live", 1000)).toEqual(principal);
    await store.put("fresh", principal, 3000);
    expect(await store.get("fresh", 1000)).toEqual(principal);
  });
  it("queries only operational identity fields under the agreed environment schema", async () => {
    const { db, sqlite: sql } = sqlite();
    sql.exec(
      "INSERT INTO appbase_billing_accounts(owner_sub,app_user_id) VALUES ('user','payment-user');",
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

// Covers: S_ADMIN_CUSTOMERS case=happy_path
// Covers: S_ADMIN_CUSTOMERS case=error_path
// Covers: S_ADMIN_CUSTOMERS case=contract
describe("customer collection", () => {
  it("paginates, searches literally and projects membership without private state", async () => {
    const s = http();
    await s.billing.synchronize("user");
    s.sqlite.exec(
      "INSERT INTO appbase_billing_accounts(environment,owner_sub,app_user_id) VALUES ('production','a_percent%','payment-a'),('production','b','payment-b'),('sandbox','sandbox-only','sandbox-id')",
    );
    const first = await s.request("/customers?pageSize=2");
    expect(first.status).toBe(200);
    const body =
      await first.json<Awaited<ReturnType<typeof s.service.customers>>>();
    expect(body.pagination).toEqual({
      page: 1,
      pageSize: 2,
      totalItems: 3,
      totalPages: 2,
    });
    expect(body.items.map((c: { ownerSub: string }) => c.ownerSub)).toEqual([
      "a_percent%",
      "b",
    ]);
    expect(first.headers.get("Link")).toContain('rel="next"');
    const second = await (
      await s.request("/customers?pageSize=2&page=2")
    ).json<Awaited<ReturnType<typeof s.service.customers>>>();
    expect(second.items[0]).toMatchObject({
      ownerSub: "user",
      planId: "studio",
      isPaid: true,
      synchronizedAt: "2026-09-07T00:00:00.000Z",
    });
    expect(Object.keys(second.items[0]!).sort()).toEqual(
      [
        "ownerSub",
        "appUserId",
        "planId",
        "planName",
        "isPaid",
        "synchronizedAt",
      ].sort(),
    );
    expect(
      (
        await (
          await s.request("/customers?query=%25")
        ).json<Awaited<ReturnType<typeof s.service.customers>>>()
      ).pagination.totalItems,
    ).toBe(1);
    expect(
      (
        await (
          await s.request("/customers?query=payment-b")
        ).json<Awaited<ReturnType<typeof s.service.customers>>>()
      ).items[0]!.ownerSub,
    ).toBe("b");
    expect(
      (
        await (
          await s.request("/customers?query=sandbox-only")
        ).json<Awaited<ReturnType<typeof s.service.customers>>>()
      ).items,
    ).toEqual([]);
    for (const query of [
      "page=0",
      "page=1.5",
      "pageSize=51",
      "page=999999999999999",
      "query=" + "x".repeat(201),
    ])
      expect((await s.request("/customers?" + query)).status).toBe(422);
    expect(
      (
        await s.request("/customers", "GET", undefined, {
          Authorization: "appbase:read",
        })
      ).status,
    ).toBe(403);
  });
});
