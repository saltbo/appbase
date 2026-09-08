import type {
  AdminEnvironment,
  AdminGrantRepository,
  ManualGrant,
  AdminRevision,
} from "../usecases/admin.js";

type Row = {
  id: string;
  environment: AdminEnvironment;
  owner_sub: string;
  plan_id: string;
  starts_at: string;
  ends_at: string;
  reason: string;
  created_by: string;
  created_at: string;
  previous_plan_id: string;
  catalog_revision: number;
  revoked_by: string | null;
  revoked_at: string | null;
  revocation_reason: string | null;
};
const columns =
  "id, environment, owner_sub, plan_id, starts_at, ends_at, reason, created_by, created_at, previous_plan_id, catalog_revision, revoked_by, revoked_at, revocation_reason";
const map = (r: Row): ManualGrant => ({
  id: r.id,
  environment: r.environment,
  ownerSub: r.owner_sub,
  planId: r.plan_id,
  startsAt: r.starts_at,
  endsAt: r.ends_at,
  source: "manual",
  reason: r.reason,
  createdBy: r.created_by,
  createdAt: r.created_at,
  previousPlanId: r.previous_plan_id,
  catalogRevision: r.catalog_revision,
  revocation:
    r.revoked_at === null
      ? null
      : {
          createdBy: r.revoked_by!,
          createdAt: r.revoked_at,
          reason: r.revocation_reason!,
        },
});

export class D1AdminRepository implements AdminGrantRepository {
  constructor(
    private readonly db: D1Database,
    readonly environment: AdminEnvironment,
  ) {}
  async revision(ownerSub: string, now: string): Promise<AdminRevision> {
    const row = await this.db
      .prepare(
        `SELECT
      COALESCE((SELECT revision FROM appbase_admin_user_revisions WHERE environment=?1 AND owner_sub=?2),0) AS user_revision,
      COALESCE((SELECT revision FROM appbase_admin_catalog_revisions WHERE environment=?1),0) AS catalog_revision,
      (SELECT MIN(boundary) FROM (
        SELECT starts_at AS boundary FROM appbase_admin_grants WHERE environment=?1 AND owner_sub=?2 AND revoked_at IS NULL
        UNION ALL SELECT ends_at FROM appbase_admin_grants WHERE environment=?1 AND owner_sub=?2 AND revoked_at IS NULL
        UNION ALL SELECT starts_at FROM appbase_membership_grants WHERE environment=?1 AND owner_sub=?2
        UNION ALL SELECT ends_at FROM appbase_membership_grants WHERE environment=?1 AND owner_sub=?2
        UNION ALL SELECT json_extract(e.value,'$.startsAt') FROM appbase_billing_accounts a,json_each(a.state_json,'$.entitlements') e WHERE a.environment=?1 AND a.owner_sub=?2
        UNION ALL SELECT json_extract(e.value,'$.expiresAt') FROM appbase_billing_accounts a,json_each(a.state_json,'$.entitlements') e WHERE a.environment=?1 AND a.owner_sub=?2
        UNION ALL SELECT json_extract(e.value,'$.graceEndsAt') FROM appbase_billing_accounts a,json_each(a.state_json,'$.entitlements') e WHERE a.environment=?1 AND a.owner_sub=?2
      ) WHERE boundary>?3) AS next_boundary`,
      )
      .bind(this.environment, ownerSub, now)
      .first<{
        user_revision: number;
        catalog_revision: number;
        next_boundary: string | null;
      }>();
    if (!row) throw new Error("Admin revision query returned no row.");
    const date = new Date(now);
    const nextMonth = Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      1,
    );
    return {
      user: row.user_revision,
      catalog: row.catalog_revision,
      validUntil: Math.floor(
        Math.min(
          date.getTime() + 300_000,
          nextMonth,
          row.next_boundary === null ? Infinity : Date.parse(row.next_boundary),
        ) / 1000,
      ),
    };
  }
  async activeGrant(ownerSub: string, now: string) {
    const row = await this.db
      .prepare(
        `SELECT ${columns} FROM appbase_admin_grants WHERE environment=?1 AND owner_sub=?2 AND starts_at<=?3 AND ends_at>?3 AND revoked_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 1`,
      )
      .bind(this.environment, ownerSub, now)
      .first<Row>();
    return row ? map(row) : null;
  }
  async list(ownerSub: string, before?: string) {
    // The cursor is a grant id; rows are immutable except for revocation audit.
    const rows = await this.db
      .prepare(
        `SELECT ${columns} FROM appbase_admin_grants WHERE environment=?1 AND owner_sub=?2 AND (?3 IS NULL OR (created_at,id) < (SELECT created_at,id FROM appbase_admin_grants WHERE environment=?1 AND owner_sub=?2 AND id=?3)) ORDER BY created_at DESC,id DESC LIMIT 51`,
      )
      .bind(this.environment, ownerSub, before ?? null)
      .all<Row>();
    return rows.results.map(map);
  }
  async get(id: string) {
    const row = await this.db
      .prepare(
        `SELECT ${columns} FROM appbase_admin_grants WHERE environment=?1 AND id=?2`,
      )
      .bind(this.environment, id)
      .first<Row>();
    return row ? map(row) : null;
  }
  async create(g: ManualGrant, expected: AdminRevision) {
    if (g.environment !== this.environment)
      throw new Error("Admin environment mismatch.");
    const r = await this.db
      .prepare(
        `INSERT INTO appbase_admin_grants(environment,id,owner_sub,plan_id,starts_at,ends_at,reason,created_by,created_at,previous_plan_id,catalog_revision)
         SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11
         WHERE COALESCE((SELECT revision FROM appbase_admin_user_revisions WHERE environment=?1 AND owner_sub=?3),0)=?12
           AND COALESCE((SELECT revision FROM appbase_admin_catalog_revisions WHERE environment=?1),0)=?13
           AND COALESCE((SELECT revision FROM appbase_billing_catalog WHERE environment=?1 AND id=1),0)=?11
           AND unixepoch() < ?14
         ON CONFLICT(environment,id) DO NOTHING`,
      )
      .bind(
        this.environment,
        g.id,
        g.ownerSub,
        g.planId,
        g.startsAt,
        g.endsAt,
        g.reason,
        g.createdBy,
        g.createdAt,
        g.previousPlanId,
        g.catalogRevision,
        expected.user,
        expected.catalog,
        expected.validUntil,
      )
      .run();
    return r.meta.changes === 1;
  }
  async revoke(id: string, r: NonNullable<ManualGrant["revocation"]>) {
    const result = await this.db
      .prepare(
        `UPDATE appbase_admin_grants SET revoked_by=?3, revoked_at=?4, revocation_reason=?5 WHERE environment=?1 AND id=?2 AND revoked_at IS NULL`,
      )
      .bind(this.environment, id, r.createdBy, r.createdAt, r.reason)
      .run();
    return result.meta.changes === 1;
  }
}
