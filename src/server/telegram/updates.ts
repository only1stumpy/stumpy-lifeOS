import { and, eq, lt, or, sql } from "drizzle-orm";
import { raiseAlert } from "@/server/admin/alerts";
import { describeError, formatErrorInfo } from "@/server/diagnostics";
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
    console.error("LifeOS telegram update failed", { updateRowId, attempt: claimed.attemptCount, error: formatErrorInfo(describeError(error)) });
    await db
      .update(schema.telegramUpdates)
      .set({ status: "failed", processingStartedAt: null, lastError: "handler_failed" })
      .where(eq(schema.telegramUpdates.id, updateRowId));
    if (claimed.attemptCount >= MAX_UPDATE_ATTEMPTS) await finalizeExhaustedUpdate(updateRowId, claimed.payload, "handler_failed");
  }
}

/** Technical update records (and any payload kept for failed ones) are deleted after 14 days. */
export const TELEGRAM_UPDATE_RETENTION_DAYS = 14;

export async function purgeOldTelegramUpdates(now: Date = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - TELEGRAM_UPDATE_RETENTION_DAYS * 24 * 3600 * 1000);
  await getDb().delete(schema.telegramUpdates).where(lt(schema.telegramUpdates.receivedAt, cutoff));
}

/** A retry older than this is not parsed silently: the message is more likely a stale record than a live one. */
export const STALE_UPDATE_HOURS = 6;
/** One retried update may spend the whole AI chain (about 42 s), so a retry starts only with this much time left. */
export const RETRY_MIN_REMAINING_MS = 45_000;

export type RetryOptions = {
  /** At most this many updates per call. */
  maxUpdates?: number;
  /** Absolute time (ms since epoch) by which the caller's function must be done. */
  deadlineAt?: number;
};

export async function retryFailedTelegramUpdates(options: RetryOptions = {}): Promise<number> {
  const maxUpdates = options.maxUpdates ?? 2;
  const deadlineAt = options.deadlineAt ?? Number.POSITIVE_INFINITY;
  const db = getDb();
  const timedOut = await db
    .update(schema.telegramUpdates)
    .set({ status: "failed", processingStartedAt: null, lastError: "processing_timeout" })
    .where(and(
      eq(schema.telegramUpdates.status, "processing"),
      lt(schema.telegramUpdates.processingStartedAt, new Date(Date.now() - 120_000)),
    ))
    .returning({ id: schema.telegramUpdates.id, attemptCount: schema.telegramUpdates.attemptCount, payload: schema.telegramUpdates.payload });
  for (const row of timedOut) {
    if (row.attemptCount >= MAX_UPDATE_ATTEMPTS) await finalizeExhaustedUpdate(row.id, row.payload, "processing_timeout");
  }
  const rows = await db
    .select({ id: schema.telegramUpdates.id, receivedAt: schema.telegramUpdates.receivedAt, payload: schema.telegramUpdates.payload })
    .from(schema.telegramUpdates)
    .where(and(
      or(eq(schema.telegramUpdates.status, "received"), eq(schema.telegramUpdates.status, "failed")),
      sql`${schema.telegramUpdates.attemptCount} < ${MAX_UPDATE_ATTEMPTS}`,
    ))
    .orderBy(schema.telegramUpdates.receivedAt)
    .limit(maxUpdates);
  let processed = 0;
  for (const row of rows) {
    if (deadlineAt - Date.now() < RETRY_MIN_REMAINING_MS) break;
    if (Date.now() - row.receivedAt.getTime() > STALE_UPDATE_HOURS * 3600 * 1000) {
      await expireStaleUpdate(row.id, row.payload);
      continue;
    }
    await processStoredTelegramUpdate(row.id);
    processed += 1;
  }
  return processed;
}

const EXHAUSTED_NOTICE = "Не получилось обработать сообщение. Повтори его чуть позже или внеси запись вручную в Mini App.";
const EXHAUSTED_MARK = "exhausted_notified";

/**
 * An update that used all its attempts (or hung until the timeout): tell the user once to repeat it or enter it manually,
 * and alert the admins. The marker in last_error makes this happen only once per update.
 */
export async function finalizeExhaustedUpdate(updateRowId: string, payload: unknown, reason: string): Promise<void> {
  const [marked] = await getDb()
    .update(schema.telegramUpdates)
    .set({ lastError: EXHAUSTED_MARK })
    .where(and(
      eq(schema.telegramUpdates.id, updateRowId),
      eq(schema.telegramUpdates.status, "failed"),
      sql`${schema.telegramUpdates.lastError} IS DISTINCT FROM ${EXHAUSTED_MARK}`,
      sql`${schema.telegramUpdates.lastError} IS DISTINCT FROM 'stale'`,
    ))
    .returning({ id: schema.telegramUpdates.id });
  if (!marked) return;
  await raiseAlert("update_exhausted", `Telegram update исчерпал попытки (${reason}). Пользователю отправлено сообщение повторить или внести вручную.`, { throttleMinutes: 30 });
  const chatId = privateChatId(payload);
  if (chatId === null) return;
  await getBot().api.sendMessage(chatId, EXHAUSTED_NOTICE).catch((error: unknown) => {
    console.error("LifeOS exhausted notice failed", { error: formatErrorInfo(describeError(error)) });
  });
}

function privateChatId(payload: unknown): number | null {
  const update = payload as { message?: { chat?: { id?: number; type?: string } }; callback_query?: { message?: { chat?: { id?: number; type?: string } } } } | null;
  const chat = update?.message?.chat ?? update?.callback_query?.message?.chat;
  return chat?.type === "private" && typeof chat.id === "number" ? chat.id : null;
}

/** Gives up on an old update and, for a private message, tells the user to send it again. */
async function expireStaleUpdate(updateRowId: string, payload: unknown): Promise<void> {
  await getDb()
    .update(schema.telegramUpdates)
    .set({ status: "failed", processingStartedAt: null, lastError: "stale", attemptCount: MAX_UPDATE_ATTEMPTS, payload: {} })
    .where(eq(schema.telegramUpdates.id, updateRowId));
  const chat = (payload as { message?: { chat?: { id?: number; type?: string } } } | null)?.message?.chat;
  if (chat?.type !== "private" || typeof chat.id !== "number") return;
  await getBot().api
    .sendMessage(chat.id, "Не успел вовремя разобрать твоё сообщение и не стал записывать его задним числом. Отправь его ещё раз.")
    .catch(() => undefined);
}
