import { timingSafeEqual } from "node:crypto";
import { AppError } from "@/server/http";
import { isAdminId } from "@/server/admin/config";
import { sendAdminMessage } from "@/server/admin/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Webhook of the admin bot (its own secret). Only Telegram IDs from ADMIN_TELEGRAM_IDS get an answer, in a private chat;
 * everyone else is acknowledged and ignored, so the bot looks silent.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const secret = process.env.ADMIN_WEBHOOK_SECRET;
    if (!secret) throw new AppError(503, "Админ-бот ещё не настроен.");
    if (!constantTimeEqual(request.headers.get("x-telegram-bot-api-secret-token") ?? "", secret)) throw new AppError(401, "Недействительный запрос Telegram.");
    const raw = await request.text();
    if (raw.length === 0 || raw.length > 64_000) throw new AppError(413, "Слишком большой запрос.");
    let update: { message?: { from?: { id?: number }; chat?: { id?: number; type?: string }; text?: string } };
    try {
      update = JSON.parse(raw);
    } catch {
      throw new AppError(400, "Некорректный запрос Telegram.");
    }
    const message = update?.message;
    const fromId = message?.from?.id;
    if (typeof fromId !== "number" || message?.chat?.type !== "private" || message.chat.id !== fromId || !isAdminId(fromId)) return Response.json({ ok: true });
    await sendAdminMessage(fromId, "Админ-панель LifeOS: состояние сервиса, очередь, cron и статистика.", `${new URL(request.url).origin}/admin`);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof AppError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "Не удалось принять обновление Telegram." }, { status: 503 });
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
