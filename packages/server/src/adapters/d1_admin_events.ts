import type { AdminPaymentEvents } from "../usecases/admin_payments.js";
import type { BillingEnvironment } from "../domain/billing.js";

export class D1AdminPaymentEvents implements AdminPaymentEvents {
  constructor(
    private readonly db: D1Database,
    private readonly environment: BillingEnvironment,
  ) {}
  async list(page: number, pageSize: number) {
    const [count, rows] = await this.db.batch<Record<string, unknown>>([
      this.db
        .prepare(
          "SELECT COUNT(*) AS total FROM appbase_billing_events WHERE environment=?",
        )
        .bind(this.environment),
      this.db
        .prepare(
          "SELECT id,processed_at FROM appbase_billing_events WHERE environment=? ORDER BY processed_at DESC,id LIMIT ? OFFSET ?",
        )
        .bind(this.environment, pageSize, (page - 1) * pageSize),
    ]);
    return {
      totalItems: Number(count!.results[0]!.total),
      items: rows!.results.map((row) => ({
        id: row.id as string,
        processedAt: row.processed_at as string,
      })),
    };
  }
}
