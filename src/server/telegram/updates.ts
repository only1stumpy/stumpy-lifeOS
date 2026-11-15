import { and, eq, lt, or, sql } from "drizzle-orm";
import type { Update } from "grammy/types";
import * as schema from "@/db/schema";
import { getDb } from "@/db/client";
import { withTelegramUser } from "@/server/owner-context";
import { getBot } from "@/server/telegram/client";
import { updateRowIds } from "@/server/telegram/shared";

export const MAX_UPDATE_ATTEMPTS = 3;

let botInitialization: Promise<void> | undefined;

export async function handlePersistedUpdate(update: Update, updateRowId: string): Promise<void> {
  updateRowIds.set(update, updateRowId);
  try {
    const bot = getBot();
    if (!botInitialization) {
      botInitialization = bot.init().then(() => undefined).catch((error: unknown) => {
        botInitialization = undefined;
        throw error;
      });
    }
    await botInitialization;
    await bot.handleUpdate(update);
  } finally {
    updateRowIds.delete(update);
  }
}

export async function processStoredTelegramUpdate(updateRowId: string): Promise<void> {
  const db = getDb();
  const [row] = await db.select().from(schema.telegramUpdates).where(eq(schema.telegramUpdates.id, updateRowId)).limit(1);
  if (!row || row.status === "processed" || row.attemptCount >= MAX_UPDATE_ATTEMPTS) return;

  const [claimed] = await db
    .update(schema.telegramUpdates)
    .set({ status: "processing", processingStartedAt: new Date(), attemptCount: sql`${schema.telegramUpdates.attemptCount} + 1`, lastError: null })
    .where(and(eq(schema.telegramUpdates.id, updateRowId), or(eq(schema.telegramUpdates.status, "received"), eq(schema.telegramUpdates.status, "failed"))))
    .returning();
  if (!claimed) return;

  try {
    const [owner] = await db.select({ telegramUserId: schema.ownerSettings.telegramUserId })
      .from(schema.ownerSettings)
      .where(eq(schema.ownerSettings.id, claimed.ownerId))
      .limit(1);
    if (!owner) throw new Error("owner_missing");
    await withTelegramUser(owner.telegramUserId, () => handlePersistedUpdate(claimed.payload as unknown as Update, updateRowId));
    await db
      .update(schema.telegramUpdates)
      .set({ status: "processed", processingStartedAt: null, payload: {}, processedAt: new Date(), lastError: null })
      .where(eq(schema.telegramUpdates.id, updateRowId));
  } catch (error) {
    console.error("LifeOS telegram update failed", { updateRowId, attempt: claimed.attemptCount, error: error instanceof Error ? error.name : "unknown" });
    await db
      .update(schema.telegramUpdates)
      .set({ status: "failed", processingStartedAt: null, lastError: "handler_failed" })
      .where(eq(schema.telegramUpdates.id, updateRowId));
  }
}

/** Technical update records (and any payload kept for failed ones) are deleted after 14 days. */
export const TELEGRAM_UPDATE_RETENTION_DAYS = 14;

export async function purgeOldTelegramUpdates(now: Date = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - TELEGRAM_UPDATE_RETENTION_DAYS * 24 * 3600 * 1000);
  await getDb().delete(schema.telegramUpdates).where(lt(schema.telegramUpdates.receivedAt, cutoff));
}

export async function retryFailedTelegramUpdates(): Promise<void> {
  const db = getDb();
  await db
    .update(schema.telegramUpdates)
    .set({ status: "failed", processingStartedAt: null, lastError: "processing_timeout" })
    .where(and(
      eq(schema.telegramUpdates.status, "processing"),
      lt(schema.telegramUpdates.processingStartedAt, new Date(Date.now() - 120_000)),
    ));
  const rows = await db
    .select({ id: schema.telegramUpdates.id })
    .from(schema.telegramUpdates)
    .where(and(
      or(eq(schema.telegramUpdates.status, "received"), eq(schema.telegramUpdates.status, "failed")),
      sql`${schema.telegramUpdates.attemptCount} < ${MAX_UPDATE_ATTEMPTS}`,
    ))
    .orderBy(schema.telegramUpdates.receivedAt)
    .limit(5);
  for (const row of rows) await processStoredTelegramUpdate(row.id);
}
