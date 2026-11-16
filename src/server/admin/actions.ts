import { and, gt, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { raiseAlert } from "@/server/admin/alerts";
import { STALE_UPDATE_HOURS } from "@/server/telegram/updates";

const RETRY_LIMIT = 5;

/** Puts failed updates (not expired ones) back into the queue with a fresh attempt counter and returns their row ids. */
export async function requeueFailedUpdates(now: Date = new Date()): Promise<string[]> {
  const cutoff = new Date(now.getTime() - STALE_UPDATE_HOURS * 3600_000);
  const rows = await getDb()
    .update(schema.telegramUpdates)
    .set({ status: "received", attemptCount: 0, processingStartedAt: null, lastError: null })
    .where(and(
      sql`${schema.telegramUpdates.id} IN (
        SELECT id FROM telegram_updates
        WHERE status = 'failed' AND received_at > ${cutoff.toISOString()}::timestamptz
          AND payload <> '{}'::jsonb AND last_error IS DISTINCT FROM 'stale'
        ORDER BY received_at LIMIT ${RETRY_LIMIT})`,
      gt(schema.telegramUpdates.receivedAt, cutoff),
    ))
    .returning({ id: schema.telegramUpdates.id });
  return rows.map((row) => row.id);
}

export async function sendTestAlert(): Promise<boolean> {
  return raiseAlert("test", "тестовый алерт из админ-панели. Доставка работает.", { throttleMinutes: 0 });
}
