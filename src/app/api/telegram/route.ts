import { after } from "next/server";
import { and, eq } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { ensureOwner, touchActivity } from "@/server/lifeos";
import { processStoredTelegramUpdate } from "@/server/telegram/bot";
import { AppError } from "@/server/http";
import { consumeRateLimit, RATE_LIMITS } from "@/server/rate-limit";
import { warnAboutWeakSecretsOnce } from "@/server/security-config";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const MAX_WEBHOOK_BODY_LENGTH = 256_000;

export async function POST(request: Request): Promise<Response> {
  try {
    warnAboutWeakSecretsOnce();
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!secret) throw new AppError(503, "Telegram webhook ещё не настроен.");
    const receivedSecret = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
    if (!constantTimeEqual(receivedSecret, secret)) {
      throw new AppError(401, "Недействительный запрос Telegram.");
    }

    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_WEBHOOK_BODY_LENGTH) throw new AppError(413, "Слишком большой запрос.");
    const raw = await request.text();
    if (raw.length === 0 || raw.length > MAX_WEBHOOK_BODY_LENGTH) throw new AppError(413, "Слишком большой запрос.");

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new AppError(400, "Некорректный запрос Telegram.");
    }
    if (!isRecord(payload) || !Number.isSafeInteger(payload.update_id) || Number(payload.update_id) < 0) {
      throw new AppError(400, "Некорректный запрос Telegram.");
    }

    const actorId = getActorId(payload);
    if (actorId === null || !isPrivateUpdate(payload)) {
      // Telegram expects an acknowledgement for updates outside private chats.
      return Response.json({ ok: true });
    }
    // Beyond the per-user limit the update is acknowledged and dropped, so Telegram does not retry it.
    const messageLimit = await consumeRateLimit(getDb(), RATE_LIMITS.telegramMessages, String(actorId));
    if (!messageLimit.allowed) {
      console.warn("LifeOS telegram rate limit exceeded");
      return Response.json({ ok: true });
    }
    const owner = await ensureOwner(String(actorId));
    await touchActivity(owner);

    const db = getDb();
    const updateId = Number(payload.update_id);
    const [inserted] = await db
      .insert(schema.telegramUpdates)
      .values({ ownerId: owner.id, telegramUpdateId: updateId, payload })
      .onConflictDoNothing()
      .returning({ id: schema.telegramUpdates.id });

    let rowId = inserted?.id;
    if (!rowId) {
      const [existing] = await db
        .select({ id: schema.telegramUpdates.id, status: schema.telegramUpdates.status })
        .from(schema.telegramUpdates)
        .where(eq(schema.telegramUpdates.telegramUpdateId, updateId))
        .limit(1);
      if (!existing || existing.status === "processed" || existing.status === "processing") {
        return Response.json({ ok: true });
      }
      rowId = existing.id;
      if (existing.status === "failed") {
        await db
          .update(schema.telegramUpdates)
          .set({ status: "received", processingStartedAt: null, payload, lastError: null })
          .where(and(eq(schema.telegramUpdates.id, rowId), eq(schema.telegramUpdates.status, "failed")));
      }
    }

    // Persist first, then acknowledge Telegram. The serverless post-response hook
    // claims the row atomically so duplicate webhook deliveries cannot process it twice.
    after(async () => processStoredTelegramUpdate(rowId));
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof AppError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "Не удалось принять обновление Telegram." }, { status: 503 });
  }
}

function getActorId(update: Record<string, unknown>): number | null {
  for (const key of ["message", "edited_message", "callback_query"]) {
    const event = update[key];
    if (!isRecord(event)) continue;
    const sender = event.from;
    if (!isRecord(sender) || typeof sender.id !== "number" || !Number.isSafeInteger(sender.id) || sender.id <= 0) continue;
    return sender.id;
  }
  return null;
}

function isPrivateUpdate(update: Record<string, unknown>): boolean {
  for (const key of ["message", "edited_message", "callback_query"]) {
    const event = update[key];
    if (!isRecord(event)) continue;
    const chat = key === "callback_query" && isRecord(event.message) ? event.message.chat : event.chat;
    return isRecord(chat) && chat.type === "private";
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
