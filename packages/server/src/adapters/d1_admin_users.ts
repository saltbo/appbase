import type {
  AdminEnvironment,
  AdminUserDirectory,
} from "../usecases/admin.js";

/** Requires the billing environment migration. Never creates a payment identity. */
export class D1AdminUserDirectory implements AdminUserDirectory {
  constructor(
    private readonly db: D1Database,
    private readonly environment: AdminEnvironment,
  ) {}
  async find(query: string) {
    const account = await this.db
      .prepare(
        "SELECT owner_sub, app_user_id FROM appbase_billing_accounts WHERE environment=?1 AND (owner_sub=?2 OR app_user_id=?2) ORDER BY owner_sub LIMIT 2",
      )
      .bind(this.environment, query)
      .all<{ owner_sub: string; app_user_id: string }>();
    if (account.results.length > 1) throw new Error("Ambiguous user identity.");
    if (account.results[0])
      return {
        ownerSub: account.results[0].owner_sub,
        appUserId: account.results[0].app_user_id,
      };
    const known = await this.db
      .prepare(
        `SELECT owner_sub FROM appbase_records WHERE owner_sub=?1
      UNION SELECT owner_sub FROM appbase_membership_grants WHERE owner_sub=?1 AND environment=?2
      UNION SELECT owner_sub FROM appbase_admin_grants WHERE owner_sub=?1 AND environment=?2 LIMIT 1`,
      )
      .bind(query, this.environment)
      .first<{ owner_sub: string }>();
    return known ? { ownerSub: known.owner_sub } : null;
  }
}
