import { verifyTelegramInitData } from "@/server/telegram/auth";
import { AppError } from "@/server/http";
import { enforceRateLimit, RATE_LIMITS } from "@/server/rate-limit";

/** Admin Mini App sessions are short: the signed initData must be at most an hour old. */
export const ADMIN_INIT_DATA_MAX_AGE_SECONDS = 3600;

export function adminBotToken(): string | null {
  return process.env.ADMIN_BOT_TOKEN?.trim() || null;
}

/** Telegram IDs allowed into the admin panel and receiving alerts. Invalid entries are ignored. */
export function adminTelegramIds(): string[] {
  return (process.env.ADMIN_TELEGRAM_IDS ?? "")
    .split(/[\s,;]+/)
    .filter((id) => /^[1-9]\d{0,19}$/.test(id));
}

export function isAdminId(id: string | number): boolean {
  return adminTelegramIds().includes(String(id));
}

/**
 * Admin Mini App authorisation: initData must be signed with the ADMIN bot's token (the user bot's token does not work)
 * and the Telegram ID must be in ADMIN_TELEGRAM_IDS. Anything else is 403.
 */
export async function requireAdmin(request: Request, now?: number): Promise<{ id: string }> {
  const token = adminBotToken();
  if (!token || adminTelegramIds().length === 0) throw new AppError(503, "Админ-панель не настроена.");
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("tma ")) throw new AppError(401, "Откройте админ-панель через админ-бота.");
  const result = verifyTelegramInitData(auth.slice(4), { botToken: token, maxAgeSeconds: ADMIN_INIT_DATA_MAX_AGE_SECONDS, now });
  if (!result.ok || !isAdminId(result.user.id)) throw new AppError(403, "Доступ запрещён.");
  await enforceRateLimit(RATE_LIMITS.admin, String(result.user.id));
  return { id: String(result.user.id) };
}
