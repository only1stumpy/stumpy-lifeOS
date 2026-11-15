import type { Bot, Context } from "grammy";
import { getBot } from "@/server/telegram/client";

export { sendExportToChat, sendOwnerMessage, sendDeduplicatedOwnerNotification, sendDuePaymentReminder, sendDueDebtReminder, sendDailySummary, sendWeeklySummary, sendWeightReminder } from "@/server/telegram/notifications";
export { handlePersistedUpdate, processStoredTelegramUpdate, TELEGRAM_UPDATE_RETENTION_DAYS, purgeOldTelegramUpdates, retryFailedTelegramUpdates } from "@/server/telegram/updates";

export function getTelegramBot(): Bot<Context> {
  return getBot();
}
