import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { unstable_splitSqlQuery } from "wrangler";
import { D1AccountDeletionRepository } from "../src/adapters/d1_account_deletion.js";
import {
  AccountDeletionService,
  AccountDeletedError,
} from "../src/usecases/account_deletion.js";
import { D1BillingRepository } from "../src/adapters/d1_billing_repository.js";
import { RevenueCatProvider } from "../src/adapters/revenuecat.js";
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
    "0007_account_deletion.sql",
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

describe("application account deletion in D1", () => {
  it("erases both billing environments and sync data, isolates other accounts, fences stale writers", async () => {
    const repository = new D1AccountDeletionRepository(db);
    const provider = vi.fn(async () => {});
    const service = new AccountDeletionService(repository, provider);
    for (const owner of ["delete-me", "keep-me"]) {
      await db
        .prepare(
          "INSERT INTO appbase_records(owner_sub,collection,record_id,device_id,mutation_id,revision,payload_json,created_at) VALUES (?, 'c', 'r', 'd', 'm', 'v', 'private', 'now')",
        )
        .bind(owner)
        .run();
      await db
        .prepare(
          "INSERT INTO appbase_user_keys VALUES (?,1,'wrapped','nonce','now')",
        )
        .bind(owner)
        .run();
      for (const env of ["production", "sandbox"] as const)
        await new D1BillingRepository(db, env).identity(owner);
    }
    await service.requireActive("delete-me");
    await service.delete("delete-me");
    await expect(service.requireActive("delete-me")).rejects.toBeInstanceOf(
      AccountDeletedError,
    );
    await service.requireActive("keep-me");
    expect(provider).toHaveBeenCalledTimes(2);
    for (const table of [
      "appbase_records",
      "appbase_user_keys",
      "appbase_billing_accounts",
    ]) {
      expect(
        await db
          .prepare(`SELECT 1 FROM ${table} WHERE owner_sub='delete-me'`)
          .first(),
      ).toBeNull();
      expect(
        await db
          .prepare(`SELECT 1 FROM ${table} WHERE owner_sub='keep-me'`)
          .first(),
      ).not.toBeNull();
    }
    await expect(
      new D1BillingRepository(db).identity("delete-me"),
    ).rejects.toThrow("APPBASE_ACCOUNT_DELETED");
    await expect(
      db
        .prepare(
          "INSERT INTO appbase_user_keys VALUES ('delete-me',2,'late','nonce','now')",
        )
        .run(),
    ).rejects.toThrow("APPBASE_ACCOUNT_DELETED");
    await expect(
      db
        .prepare(
          "INSERT INTO appbase_membership_usage VALUES ('production','delete-me','ai','month','late','now')",
        )
        .run(),
    ).rejects.toThrow("APPBASE_ACCOUNT_DELETED");
    await service.delete("delete-me");
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it("keeps failed provider cleanup retryable without restoring application access", async () => {
    const repository = new D1AccountDeletionRepository(db);
    const id = await new D1BillingRepository(db).identity("retry-me");
    const provider = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const service = new AccountDeletionService(repository, provider);
    await expect(service.delete("retry-me")).rejects.toThrow("offline");
    expect(await repository.pendingBillingIdentities("retry-me")).toEqual([id]);
    await expect(service.requireActive("retry-me")).rejects.toBeInstanceOf(
      AccountDeletedError,
    );
    await service.delete("retry-me");
    expect(provider.mock.calls.map((c) => c[0])).toEqual([id, id]);
    expect(await repository.pendingBillingIdentities("retry-me")).toEqual([]);
  });

  it("uses the provider deletion operation and treats already deleted as success", async () => {
    for (const status of [200, 404, 503]) {
      const request = vi.fn(async () => new Response(null, { status }));
      const provider = new RevenueCatProvider("fixture-secret", request);
      if (status === 503)
        await expect(provider.deleteSubscriber("a/b")).rejects.toThrow("503");
      else await provider.deleteSubscriber("a/b");
      expect(request).toHaveBeenCalledWith(
        "https://api.revenuecat.com/v1/subscribers/a%2Fb",
        expect.objectContaining({ method: "DELETE" }),
      );
    }
    await expect(
      new RevenueCatProvider("").deleteSubscriber("unused"),
    ).rejects.toThrow("credentials");
  });
});
