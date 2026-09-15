import type {
  AccountRepository,
  ApplicationAccount,
  DeviceSession,
} from "../usecases/accounts.js";

export class D1AccountRepository implements AccountRepository {
  constructor(readonly db: D1Database) {}
  current(subject: string): Promise<ApplicationAccount | null> {
    return this.db
      .prepare(
        "SELECT id,subject,status,legacy FROM appbase_accounts WHERE subject=?",
      )
      .bind(subject)
      .first();
  }
  find(id: string): Promise<ApplicationAccount | null> {
    return this.db
      .prepare(
        "SELECT id,subject,status,legacy FROM appbase_accounts WHERE id=?",
      )
      .bind(id)
      .first();
  }
  async register(subject: string, id: string, now: number) {
    await this.db
      .prepare(
        "INSERT INTO appbase_accounts(id,subject,status,created_at) VALUES (?,?,'active',?) ON CONFLICT DO NOTHING",
      )
      .bind(id, subject, now)
      .run();
    const account = await this.current(subject);
    if (!account) throw new Error("Account registration did not persist.");
    return account;
  }
  async saveSession(hash: string, s: DeviceSession, now: number) {
    await this.db
      .prepare(
        "INSERT INTO appbase_devices(token_hash,account_id,device_id,scopes_json,created_at,expires_at) VALUES (?,?,?,?,?,?)",
      )
      .bind(
        hash,
        s.accountId,
        s.deviceId,
        JSON.stringify(s.scopes),
        now,
        s.expiresAt,
      )
      .run();
  }
  async session(hash: string): Promise<DeviceSession | null> {
    const row = await this.db
      .prepare(
        "SELECT d.account_id,d.device_id,d.scopes_json,d.expires_at,a.subject FROM appbase_devices d JOIN appbase_accounts a ON a.id=d.account_id WHERE d.token_hash=?",
      )
      .bind(hash)
      .first<{
        account_id: string;
        device_id: string;
        scopes_json: string;
        expires_at: number;
        subject: string;
      }>();
    return row
      ? {
          accountId: row.account_id,
          deviceId: row.device_id,
          scopes: JSON.parse(row.scopes_json),
          expiresAt: row.expires_at,
          subject: row.subject ?? "",
        }
      : null;
  }
  async revokeSession(hash: string) {
    await this.db
      .prepare("DELETE FROM appbase_devices WHERE token_hash=?")
      .bind(hash)
      .run();
  }
  async isDeleted(id: string) {
    const account = await this.find(id);
    return !!account && account.status !== "active";
  }
  async begin(id: string) {
    if (!(await this.find(id)))
      throw new Error("Application account does not exist.");
    await this.db.batch([
      this.db
        .prepare(
          "UPDATE appbase_accounts SET status='deleting',deletion_requested_at=COALESCE(deletion_requested_at,unixepoch()),next_cleanup_at=0 WHERE id=? AND status='active'",
        )
        .bind(id),
      ...[
        "appbase_records",
        "appbase_user_keys",
        "appbase_membership_grants",
        "appbase_membership_usage",
      ].map((table) =>
        this.db.prepare(`DELETE FROM ${table} WHERE owner_sub=?`).bind(id),
      ),
    ]);
  }
  async pendingBillingIdentities(id: string) {
    return (
      await this.db
        .prepare(
          "SELECT app_user_id FROM appbase_billing_accounts WHERE owner_sub=?",
        )
        .bind(id)
        .all<{ app_user_id: string }>()
    ).results.map((r) => r.app_user_id);
  }
  async completeBillingIdentity(id: string, identity: string) {
    await this.db
      .prepare(
        "DELETE FROM appbase_billing_accounts WHERE owner_sub=? AND app_user_id=?",
      )
      .bind(id, identity)
      .run();
  }
  async complete(id: string) {
    await this.db
      .prepare(
        "UPDATE appbase_accounts SET status='deleted',subject=NULL,deleted_at=unixepoch(),next_cleanup_at=NULL WHERE id=? AND status='deleting' AND NOT EXISTS(SELECT 1 FROM appbase_billing_accounts WHERE owner_sub=?)",
      )
      .bind(id, id)
      .run();
  }
  async due(now: number, limit: number) {
    return (
      await this.db
        .prepare(
          "SELECT id FROM appbase_accounts WHERE status='deleting' AND next_cleanup_at<=? ORDER BY next_cleanup_at,id LIMIT ?",
        )
        .bind(now, limit)
        .all<{ id: string }>()
    ).results.map((r) => r.id);
  }
  async postpone(id: string, now: number) {
    await this.db
      .prepare(
        "UPDATE appbase_accounts SET cleanup_attempts=cleanup_attempts+1,next_cleanup_at=?+MIN(3600,60*(cleanup_attempts+1)) WHERE id=? AND status='deleting'",
      )
      .bind(now, id)
      .run();
  }
  async expireSessions(now: number) {
    await this.db
      .prepare("DELETE FROM appbase_devices WHERE expires_at<=?")
      .bind(now)
      .run();
  }
}
export const accountCrypto = {
  random: () => crypto.randomUUID().replaceAll("-", ""),
  async hash(value: string) {
    return [
      ...new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
      ),
    ]
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");
  },
};
