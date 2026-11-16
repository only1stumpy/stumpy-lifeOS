import { sql } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/db/client";
import journal from "../../../../drizzle/meta/_journal.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const expected = journal.entries.reduce((last, entry) => (entry.when > last.when ? entry : last));

/**
 * Readiness probe behind CRON_SECRET: the database answers and the newest migration recorded in
 * drizzle.__drizzle_migrations is the one the deployed code expects (the last entry of the journal).
 */
export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return reply(503, { status: "unconfigured" });
  if (!constantTimeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) return reply(401, { status: "unauthorized" });

  let applied: number | null;
  try {
    const result = await getDb().execute<{ created_at: string | null }>(sql`SELECT max(created_at) AS created_at FROM drizzle.__drizzle_migrations`);
    const value = result.rows[0]?.created_at;
    applied = value == null ? null : Number(value);
  } catch {
    // Either the database is unreachable or the migration journal does not exist yet.
    return reply(503, { status: "database_unavailable", expectedMigration: expected.tag });
  }
  if (applied !== expected.when) {
    return reply(503, { status: applied !== null && applied > expected.when ? "database_ahead" : "migrations_pending", expectedMigration: expected.tag });
  }
  return reply(200, { status: "ready", migration: expected.tag });
}

function reply(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
