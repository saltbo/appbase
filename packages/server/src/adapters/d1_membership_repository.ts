import type { MembershipGrant } from "../domain/membership";
import type { MembershipRepository } from "../usecases/membership_ports";

type GrantRow = {
  plan_id: string;
  starts_at: string;
  ends_at: string | null;
};

export class D1MembershipRepository implements MembershipRepository {
  constructor(private readonly database: D1Database) {}

  async activeGrant(
    ownerSub: string,
    now: string,
  ): Promise<MembershipGrant | null> {
    const row = await this.database
      .prepare(
        `SELECT plan_id, starts_at, ends_at FROM appbase_membership_grants
       WHERE owner_sub = ?1 AND starts_at <= ?2 AND (ends_at IS NULL OR ends_at > ?2)
       ORDER BY starts_at DESC LIMIT 1`,
      )
      .bind(ownerSub, now)
      .first<GrantRow>();
    return row === null
      ? null
      : {
          planId: row.plan_id,
          startsAt: row.starts_at,
          endsAt: row.ends_at,
        };
  }

  async putGrant(input: {
    id: string;
    ownerSub: string;
    planId: string;
    source: "test" | "admin" | "billing";
    startsAt: string;
    endsAt: string | null;
    createdAt: string;
  }): Promise<void> {
    await this.database
      .prepare(
        `INSERT INTO appbase_membership_grants (
         id, owner_sub, plan_id, source, starts_at, ends_at, created_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(id) DO UPDATE SET
         plan_id = excluded.plan_id,
         starts_at = excluded.starts_at,
         ends_at = excluded.ends_at`,
      )
      .bind(
        input.id,
        input.ownerSub,
        input.planId,
        input.source,
        input.startsAt,
        input.endsAt,
        input.createdAt,
      )
      .run();
  }

  async countUsage(
    ownerSub: string,
    capability: string,
    periodKey: string,
  ): Promise<number> {
    const row = await this.database
      .prepare(
        `SELECT COUNT(*) AS used FROM appbase_membership_usage
       WHERE owner_sub = ?1 AND capability = ?2 AND period_key = ?3`,
      )
      .bind(ownerSub, capability, periodKey)
      .first<{ used: number }>();
    if (row === null)
      throw new Error("Membership usage count did not return a row.");
    return row.used;
  }

  async claimUniqueUsage(input: {
    ownerSub: string;
    capability: string;
    periodKey: string;
    itemKey: string;
    limit: number;
    createdAt: string;
  }): Promise<{ allowed: boolean; created: boolean; used: number }> {
    const result = await this.database
      .prepare(
        `INSERT INTO appbase_membership_usage (
         owner_sub, capability, period_key, item_key, created_at
       )
       SELECT ?1, ?2, ?3, ?4, ?5
       WHERE EXISTS (
         SELECT 1 WHERE EXISTS (
           SELECT 1 FROM appbase_membership_usage
           WHERE owner_sub = ?1 AND capability = ?2 AND period_key = ?3 AND item_key = ?4
         ) OR (
           SELECT COUNT(*) FROM appbase_membership_usage
           WHERE owner_sub = ?1 AND capability = ?2 AND period_key = ?3
         ) < ?6
       )
       ON CONFLICT(owner_sub, capability, period_key, item_key) DO NOTHING`,
      )
      .bind(
        input.ownerSub,
        input.capability,
        input.periodKey,
        input.itemKey,
        input.createdAt,
        input.limit,
      )
      .run();
    const used = await this.countUsage(
      input.ownerSub,
      input.capability,
      input.periodKey,
    );
    const existing = await this.database
      .prepare(
        `SELECT 1 AS found FROM appbase_membership_usage
       WHERE owner_sub = ?1 AND capability = ?2 AND period_key = ?3 AND item_key = ?4`,
      )
      .bind(input.ownerSub, input.capability, input.periodKey, input.itemKey)
      .first<{ found: number }>();
    return {
      allowed: result.success && existing !== null,
      created: result.meta.changes === 1,
      used,
    };
  }

  async releaseUsage(
    ownerSub: string,
    capability: string,
    periodKey: string,
    itemKey: string,
  ): Promise<void> {
    await this.database
      .prepare(
        `DELETE FROM appbase_membership_usage
       WHERE owner_sub = ?1 AND capability = ?2 AND period_key = ?3 AND item_key = ?4`,
      )
      .bind(ownerSub, capability, periodKey, itemKey)
      .run();
  }
}
