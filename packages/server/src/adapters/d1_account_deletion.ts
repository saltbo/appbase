import type { AccountDeletionRepository } from "../usecases/account_deletion.js";

export class D1AccountDeletionRepository implements AccountDeletionRepository {
  constructor(private readonly db: D1Database) {}

  async isDeleted(ownerSub: string): Promise<boolean> {
    return (
      (await this.db
        .prepare("SELECT 1 FROM appbase_deleted_accounts WHERE owner_sub = ?")
        .bind(ownerSub)
        .first()) !== null
    );
  }

  async begin(ownerSub: string): Promise<void> {
    // D1 batches are atomic. Triggers fence requests that passed auth before this batch.
    await this.db.batch([
      this.db
        .prepare(
          "INSERT INTO appbase_deleted_accounts (owner_sub) VALUES (?) ON CONFLICT DO NOTHING",
        )
        .bind(ownerSub),
      this.db
        .prepare(
          "INSERT INTO appbase_account_deletion_billing (owner_sub, app_user_id) SELECT owner_sub, app_user_id FROM appbase_billing_accounts WHERE owner_sub = ? ON CONFLICT DO NOTHING",
        )
        .bind(ownerSub),
      ...[
        "appbase_records",
        "appbase_user_keys",
        "appbase_membership_grants",
        "appbase_membership_usage",
        "appbase_billing_accounts",
      ].map((table) =>
        this.db
          .prepare(`DELETE FROM ${table} WHERE owner_sub = ?`)
          .bind(ownerSub),
      ),
    ]);
  }

  async pendingBillingIdentities(ownerSub: string): Promise<readonly string[]> {
    const rows = await this.db
      .prepare(
        "SELECT app_user_id FROM appbase_account_deletion_billing WHERE owner_sub = ?",
      )
      .bind(ownerSub)
      .all<{ app_user_id: string }>();
    return rows.results.map((row) => row.app_user_id);
  }

  async completeBillingIdentity(
    ownerSub: string,
    identity: string,
  ): Promise<void> {
    await this.db
      .prepare(
        "DELETE FROM appbase_account_deletion_billing WHERE owner_sub = ? AND app_user_id = ?",
      )
      .bind(ownerSub, identity)
      .run();
  }
}
