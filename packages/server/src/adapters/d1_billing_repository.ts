import type {
  BillingEnvironment,
  BillingCatalog,
  BillingState,
  VersionedCatalog,
} from "../domain/billing.js";
import type { BillingRepository } from "../usecases/billing.js";

export class D1BillingRepository implements BillingRepository {
  constructor(
    private readonly db: D1Database,
    private readonly environment: BillingEnvironment = "production",
  ) {}
  async catalog(): Promise<VersionedCatalog | null> {
    const row = await this.db
      .prepare(
        "SELECT revision, catalog_json FROM appbase_billing_catalog WHERE environment = ? AND id = 1",
      )
      .bind(this.environment)
      .first<{ revision: number; catalog_json: string }>();
    return row === null
      ? null
      : {
          revision: row.revision,
          catalog: JSON.parse(row.catalog_json) as BillingCatalog,
        };
  }
  async replaceCatalog(
    catalog: BillingCatalog,
    expectedRevision: number,
  ): Promise<boolean> {
    const result =
      expectedRevision === 0
        ? await this.db
            .prepare(
              "INSERT INTO appbase_billing_catalog (environment, id, revision, catalog_json) VALUES (?, 1, 1, ?) ON CONFLICT(environment, id) DO NOTHING",
            )
            .bind(this.environment, JSON.stringify(catalog))
            .run()
        : await this.db
            .prepare(
              "UPDATE appbase_billing_catalog SET revision = revision + 1, catalog_json = ? WHERE environment = ? AND id = 1 AND revision = ?",
            )
            .bind(JSON.stringify(catalog), this.environment, expectedRevision)
            .run();
    return result.meta.changes > 0;
  }
  async identity(ownerSub: string): Promise<string> {
    await this.db
      .prepare(
        "INSERT INTO appbase_billing_accounts (environment, owner_sub, app_user_id) VALUES (?, ?, ?) ON CONFLICT(environment, owner_sub) DO NOTHING",
      )
      .bind(this.environment, ownerSub, crypto.randomUUID())
      .run();
    const row = await this.db
      .prepare(
        "SELECT app_user_id FROM appbase_billing_accounts WHERE environment = ? AND owner_sub = ?",
      )
      .bind(this.environment, ownerSub)
      .first<{ app_user_id: string }>();
    if (!row) throw new Error("Billing identity was not persisted.");
    return row.app_user_id;
  }
  async owner(appUserId: string): Promise<string | null> {
    const row = await this.db
      .prepare(
        "SELECT owner_sub FROM appbase_billing_accounts WHERE environment = ? AND app_user_id = ?",
      )
      .bind(this.environment, appUserId)
      .first<{ owner_sub: string }>();
    return row?.owner_sub ?? null;
  }
  async beginSync(ownerSub: string): Promise<number> {
    const row = await this.db
      .prepare(
        "UPDATE appbase_billing_accounts SET generation = generation + 1 WHERE environment = ? AND owner_sub = ? RETURNING generation",
      )
      .bind(this.environment, ownerSub)
      .first<{ generation: number }>();
    if (!row) throw new Error("Billing account is missing.");
    return row.generation;
  }
  async commitSync(
    ownerSub: string,
    generation: number,
    state: BillingState,
  ): Promise<boolean> {
    // One authoritative snapshot also supplies the membership grant projection.
    const result = await this.db
      .prepare(
        "UPDATE appbase_billing_accounts SET state_json = ? WHERE environment = ? AND owner_sub = ? AND generation = ? AND (state_json IS NULL OR json_extract(state_json, '$.observedAt') <= ?)",
      )
      .bind(
        JSON.stringify(state),
        this.environment,
        ownerSub,
        generation,
        state.observedAt,
      )
      .run();
    return result.meta.changes > 0;
  }
  async state(ownerSub: string): Promise<BillingState | null> {
    const row = await this.db
      .prepare(
        "SELECT state_json FROM appbase_billing_accounts WHERE environment = ? AND owner_sub = ?",
      )
      .bind(this.environment, ownerSub)
      .first<{ state_json: string | null }>();
    return row?.state_json == null
      ? null
      : (JSON.parse(row.state_json) as BillingState);
  }
  async eventProcessed(eventId: string): Promise<boolean> {
    return (
      (await this.db
        .prepare(
          "SELECT id FROM appbase_billing_events WHERE environment = ? AND id = ?",
        )
        .bind(this.environment, eventId)
        .first()) !== null
    );
  }
  async markEventProcessed(eventId: string): Promise<void> {
    await this.db
      .prepare(
        "INSERT INTO appbase_billing_events (environment, id, processed_at) VALUES (?, ?, ?) ON CONFLICT(environment, id) DO NOTHING",
      )
      .bind(this.environment, eventId, new Date().toISOString())
      .run();
  }
}
