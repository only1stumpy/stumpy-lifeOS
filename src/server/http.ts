import { consentState } from "@/domain/privacy";
import { verifyTelegramInitData } from "./telegram/auth";
export class AppError extends Error {
  constructor(public status: number, message: string, public retryAfterSeconds?: number) { super(message); }
}
export function requireOwner(request: Request) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) throw new AppError(503, "Telegram ещё не настроен.");
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("tma ")) throw new AppError(401, "Открой приложение через Telegram.");
  const result = verifyTelegramInitData(auth.slice(4), { botToken });
  if (!result.ok) throw new AppError(401, "Сессия Telegram недействительна. Открой приложение заново.");
  return result.user;
}

/** The server enforces consent itself: a signed request alone is not enough to write or analyse data (403). */
export function assertConsent(owner: { privacyPolicyVersion: string | null; healthConsentVersion: string | null }): void {
  const state = consentState(owner);
  if (state === "policy") throw new AppError(403, "Сначала прими политику конфиденциальности и условия использования.");
  if (state === "health") throw new AppError(403, "Сначала дай согласие на обработку данных о здоровье.");
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
  if (error instanceof Error && error.name === "ZodError") return Response.json({ error: "Проверь значения полей." }, { status: 400 });
  console.error("LifeOS request failed", error instanceof Error ? error.name : "unknown");
  return Response.json({ error: "Не удалось выполнить действие. Данные не подтверждены." }, { status: 500 });
}
