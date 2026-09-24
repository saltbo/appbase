import { beforeAll, afterAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { unstable_splitSqlQuery } from "wrangler";
import {
  D1AccountRepository,
  accountCrypto,
} from "../src/adapters/d1_accounts.js";
import { D1EnvelopeSecretCodec } from "../src/adapters/envelope_secret_codec.js";
import { D1BillingRepository } from "../src/adapters/d1_billing_repository.js";
import { AccountService, accountOwner } from "../src/usecases/accounts.js";
import { AccountDeletionService } from "../src/usecases/account_deletion.js";
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
    "0008_application_accounts.sql",
    "0009_account_uuid_context.sql",
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

async function migrate() {
  const sql = readFileSync(
    new URL("../maintenance/normalize_account_ids.sql", import.meta.url),
    "utf8",
  );
  return db.batch(unstable_splitSqlQuery(sql).map((s) => db.prepare(s)));
}

it("migrates owners atomically while preserving encryption, client bindings, payments, cursors and deletion fences", async () => {
  const old = "a_0123456789ab4def8123456789abcdef";
  const id = "01234567-89ab-4def-8123-456789abcdef";
  const repo = new D1AccountRepository(db);
  const service = new AccountService(
    repo,
    new AccountDeletionService(repo, async () => {}),
    accountCrypto,
    () => 1000,
  );
  const identity = { sub: "migration-user", scopes: [] };
  await repo.register(identity.sub, old, 1000);
  const session = await service.open(identity, {
    deviceId: "phone",
    register: false,
  });
  const codec = new D1EnvelopeSecretCodec(
    db,
    btoa("x".repeat(32)),
    1,
    (owner) => repo.encryptionOwner(owner),
  );
  const envelope = await codec.seal(old, "sources", "private", {
    password: "fixture-only",
  });
  await db
    .prepare(
      "INSERT INTO appbase_records(owner_sub,collection,record_id,device_id,mutation_id,revision,payload_json,created_at) VALUES (?,'sources','private','phone','m','revision',?,'now')",
    )
    .bind(old, JSON.stringify(envelope))
    .run();
  const before = await db
    .prepare(
      "SELECT sequence,payload_json FROM appbase_records WHERE owner_sub=?",
    )
    .bind(old)
    .first();
  const paymentIds = [];
  for (const env of ["production", "sandbox"] as const) {
    paymentIds.push(await new D1BillingRepository(db, env).identity(old));
    await db
      .prepare(
        "INSERT INTO appbase_membership_usage VALUES (?,?,'ai','month','item','now')",
      )
      .bind(env, old)
      .run();
  }
  await repo.register("untouched", "already-standard", 1000);
  await migrate();
  expect((await repo.current(identity.sub))?.id).toBe(id);
  expect((await repo.find(old))?.id).toBe(id);
  expect((await repo.find("already-standard"))?.clientId).toBeNull();
  expect(await service.status(identity)).toEqual({
    accountId: old,
    status: "active",
  });
  const principal = await service.authenticate(session.accessToken);
  expect(accountOwner(principal)).toBe(id);
  expect(
    (
      await service.open(identity, {
        deviceId: "phone",
        register: false,
        accountId: old,
      })
    ).accountId,
  ).toBe(old);
  await expect(
    service.open(
      { sub: "intruder", scopes: [] },
      { deviceId: "phone", register: false, accountId: old },
    ),
  ).rejects.toThrow();
  expect(
    await db
      .prepare(
        "SELECT sequence,payload_json FROM appbase_records WHERE owner_sub=?",
      )
      .bind(id)
      .first(),
  ).toEqual(before);
  expect(await codec.open(id, "sources", "private", envelope)).toEqual({
    password: "fixture-only",
  });
  const freshEnvelope = await codec.seal(id, "sources", "next", { new: true });
  expect(await codec.open(id, "sources", "next", freshEnvelope)).toEqual({
    new: true,
  });
  await expect(
    codec.open("already-standard", "sources", "private", envelope),
  ).rejects.toThrow();
  for (const [i, env] of (["production", "sandbox"] as const).entries()) {
    expect(await new D1BillingRepository(db, env).identity(id)).toBe(
      paymentIds[i],
    );
    expect(await new D1BillingRepository(db, env).owner(paymentIds[i]!)).toBe(
      id,
    );
  }
  for (const table of [
    "appbase_records",
    "appbase_user_keys",
    "appbase_membership_usage",
    "appbase_billing_accounts",
  ]) {
    expect(
      await db
        .prepare(`SELECT 1 FROM ${table} WHERE owner_sub=?`)
        .bind(old)
        .first(),
    ).toBeNull();
  }
  await migrate(); // Safe if the data step is retried after a lost response.
  await service.requestDeletion(principal);
  await service.processDue();
  const replacement = await service.open(identity, {
    deviceId: "phone",
    register: true,
  });
  expect(replacement.accountId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  await expect(
    service.open(identity, {
      deviceId: "phone",
      register: false,
      accountId: old,
    }),
  ).rejects.toThrow();
  await expect(
    service.requireAccount(await service.authenticate(session.accessToken)),
  ).rejects.toThrow();
});

it("rejects malformed IDs and UUID collisions without partial owner rewrites", async () => {
  const repo = new D1AccountRepository(db);
  await repo.register("invalid", "a_invalid", 1000);
  await expect(migrate()).rejects.toThrow();
  expect((await repo.find("a_invalid"))?.id).toBe("a_invalid");
  await db.prepare("DELETE FROM appbase_accounts WHERE id='a_invalid'").run();
  const old = "a_1123456789ab4def8123456789abcdef";
  const id = "11234567-89ab-4def-8123-456789abcdef";
  await repo.register("collision-old", old, 1000);
  await repo.register("collision-new", id, 1000);
  await expect(migrate()).rejects.toThrow();
  expect((await repo.find(old))?.id).toBe(old);
  expect((await repo.find(id))?.subject).toBe("collision-new");
});
