import { AsyncLocalStorage } from "node:async_hooks";

const telegramUserContext = new AsyncLocalStorage<string>();

/** Runs LifeOS work in an explicitly authenticated Telegram user's scope. */
export function withTelegramUser<T>(telegramUserId: string, callback: () => T): T {
  return telegramUserContext.run(telegramUserId, callback);
}

/** The request/update-scoped Telegram ID; falls back to the legacy owner only for CLI jobs. */
export function currentTelegramUserId(): string | undefined {
  return telegramUserContext.getStore();
}

export function resolveTelegramUserId(explicitId?: string): string | undefined {
  return explicitId ?? currentTelegramUserId() ?? (process.env.TELEGRAM_OWNER_ID?.trim() || undefined);
}
