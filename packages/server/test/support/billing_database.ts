import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
export function migrate(db: DatabaseSync, name: string) {
  db.exec(
    readFileSync(
      new URL(`../../migrations/${name}.sql`, import.meta.url),
      "utf8",
    ),
  );
}
export function database(
  beforeMigration?: (db: DatabaseSync) => void,
): D1Database {
  const db = new DatabaseSync(":memory:");
  migrate(db, "0001_appbase");
  migrate(db, "0003_billing");
  beforeMigration?.(db);
  migrate(db, "0004_billing_environments");
  const prepare = (
    sql: string,
    args: SQLInputValue[] = [],
  ): D1PreparedStatement =>
    ({
      bind: (...values: SQLInputValue[]) => prepare(sql, values),
      first: async () => db.prepare(sql).get(...args) ?? null,
      run: async () => ({
        success: true,
        meta: { changes: Number(db.prepare(sql).run(...args).changes) },
      }),
    }) as D1PreparedStatement;
  return { prepare } as D1Database;
}
