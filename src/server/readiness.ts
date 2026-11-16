import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import journal from "../../drizzle/meta/_journal.json";

export const expectedMigration = journal.entries.reduce((last, entry) => (entry.when > last.when ? entry : last));

export type Readiness =
  | { status: "ready"; migration: string }
  | { status: "database_unavailable" | "migrations_pending" | "database_ahead"; expectedMigration: string };

/**
 * The database answers and the newest migration recorded in drizzle.__drizzle_migrations is the one
 * the deployed code expects (the last entry of the journal).
 */
export async function checkReadiness(): Promise<Readiness> {
  let applied: number | null;
  try {
    const result = await getDb().execute<{ created_at: string | null }>(sql`SELECT max(created_at) AS created_at FROM drizzle.__drizzle_migrations`);
    const value = result.rows[0]?.created_at;
    applied = value == null ? null : Number(value);
  } catch {
    // Either the database is unreachable or the migration journal does not exist yet.
    return { status: "database_unavailable", expectedMigration: expectedMigration.tag };
  }
  if (applied !== expectedMigration.when) {
    return { status: applied !== null && applied > expectedMigration.when ? "database_ahead" : "migrations_pending", expectedMigration: expectedMigration.tag };
  }
  return { status: "ready", migration: expectedMigration.tag };
}
