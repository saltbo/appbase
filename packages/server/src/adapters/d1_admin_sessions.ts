import type { AdminSessionStore } from "../http/admin_oidc.js";
import type { Principal } from "../usecases/ports.js";
export class D1AdminSessionStore implements AdminSessionStore {
  constructor(private readonly db: D1Database) {}
  async startAttempt(idHash: string, expiresAt: number) {
    await this.db
      .prepare(
        "INSERT INTO appbase_admin_login_attempts(id_hash,expires_at) VALUES (?1,?2)",
      )
      .bind(idHash, expiresAt)
      .run();
  }
  async consumeAttempt(idHash: string, now: number) {
    const result = await this.db
      .prepare(
        "DELETE FROM appbase_admin_login_attempts WHERE id_hash=?1 AND expires_at>?2",
      )
      .bind(idHash, now)
      .run();
    return result.meta.changes === 1;
  }
  async put(idHash: string, principal: Principal, expiresAt: number) {
    await this.db
      .prepare(
        "INSERT INTO appbase_admin_sessions(id_hash,principal_json,expires_at) VALUES (?1,?2,?3)",
      )
      .bind(idHash, JSON.stringify(principal), expiresAt)
      .run();
  }
  async get(idHash: string, now: number) {
    const r = await this.db
      .prepare(
        "SELECT principal_json FROM appbase_admin_sessions WHERE id_hash=?1 AND expires_at>?2",
      )
      .bind(idHash, now)
      .first<{ principal_json: string }>();
    return r ? (JSON.parse(r.principal_json) as Principal) : null;
  }
  async delete(idHash: string) {
    await this.db
      .prepare("DELETE FROM appbase_admin_sessions WHERE id_hash=?1")
      .bind(idHash)
      .run();
  }
}
