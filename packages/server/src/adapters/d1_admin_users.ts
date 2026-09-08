import type { BillingState } from "../domain/billing.js";
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
  async list(input: {
    page: number;
    pageSize: number;
    query: string;
    now: string;
  }) {
    // A fixed two-query batch, without loading private records or counting usage per customer.
    const pattern = "%" + input.query.replace(/[\\%_]/gu, "\\$&") + "%";
    const where =
      "a.environment=?1 AND (a.owner_sub LIKE ?2 ESCAPE '\\' OR a.app_user_id LIKE ?2 ESCAPE '\\')";
    const [count, rows] = await this.db.batch<Record<string, unknown>>([
      this.db
        .prepare(
          `SELECT COUNT(*) AS total FROM appbase_billing_accounts a WHERE ${where}`,
        )
        .bind(this.environment, pattern),
      this.db
        .prepare(
          `SELECT a.owner_sub, a.app_user_id, a.state_json,
        (SELECT g.plan_id FROM appbase_membership_grants g
         WHERE g.environment=a.environment AND g.owner_sub=a.owner_sub
           AND g.starts_at<=?3 AND (g.ends_at IS NULL OR g.ends_at>?3)
         ORDER BY g.starts_at DESC LIMIT 1) AS legacy_plan_id
        FROM appbase_billing_accounts a WHERE ${where}
        ORDER BY a.owner_sub LIMIT ?4 OFFSET ?5`,
        )
        .bind(
          this.environment,
          pattern,
          input.now,
          input.pageSize,
          (input.page - 1) * input.pageSize,
        ),
    ]);
    return {
      totalItems: Number(count!.results[0]!.total),
      items: rows!.results.map((row) => ({
        ownerSub: row.owner_sub as string,
        appUserId: row.app_user_id as string,
        state:
          row.state_json == null
            ? null
            : (JSON.parse(row.state_json as string) as BillingState),
        legacyPlanId: row.legacy_plan_id as string | null,
      })),
    };
  }
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
      UNION SELECT owner_sub FROM appbase_membership_grants WHERE owner_sub=?1 AND environment=?2 LIMIT 1`,
      )
      .bind(query, this.environment)
      .first<{ owner_sub: string }>();
    return known ? { ownerSub: known.owner_sub } : null;
  }
}
