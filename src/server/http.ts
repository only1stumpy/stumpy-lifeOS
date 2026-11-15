import { verifyTelegramInitData } from "./telegram/auth";
export class AppError extends Error {
  constructor(public status: number, message: string, public retryAfterSeconds?: number) { super(message); }
}
export function requireOwner(request: Request) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) throw new AppError(503, "Telegram ещё не настроен.");
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("tma ")) throw new AppError(401, "Откройте приложение через Telegram.");
  const result = verifyTelegramInitData(auth.slice(4), { botToken });
  if (!result.ok) throw new AppError(401, "Сессия Telegram недействительна. Откройте приложение заново.");
  return result.user;
}

/** Allows access to deployment-level quota metrics only for the legacy configured owner. */
export function requireConfiguredOwner(request: Request) {
  const user = requireOwner(request);
  const ownerId = process.env.TELEGRAM_OWNER_ID?.trim();
  if (!ownerId || String(user.id) !== ownerId) throw new AppError(403, "Эти метрики доступны владельцу конфигурации.");
  return user;
}
export function errorResponse(error: unknown) {
  if (error instanceof AppError) return Response.json({ error: error.message }, { status: error.status, headers: error.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : undefined });
  if (error instanceof Error && error.name === "ZodError") return Response.json({ error: "Проверьте значения полей." }, { status: 400 });
  console.error("LifeOS request failed", error instanceof Error ? error.name : "unknown");
  return Response.json({ error: "Не удалось выполнить действие. Данные не подтверждены." }, { status: 500 });
}
