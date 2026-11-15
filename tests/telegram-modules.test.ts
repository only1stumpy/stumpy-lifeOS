import assert from "node:assert/strict";
import test from "node:test";
import * as bot from "@/server/telegram/bot";
import { AppError } from "@/server/http";

const functionNames = [
  "sendExportToChat",
  "getTelegramBot",
  "sendOwnerMessage",
  "handlePersistedUpdate",
  "processStoredTelegramUpdate",
  "purgeOldTelegramUpdates",
  "retryFailedTelegramUpdates",
  "sendDeduplicatedOwnerNotification",
  "sendDuePaymentReminder",
  "sendDueDebtReminder",
  "sendDailySummary",
  "sendWeeklySummary",
  "sendWeightReminder",
] as const;

test("bot.ts re-exports the public telegram API", () => {
  for (const name of functionNames) assert.equal(typeof bot[name], "function", name);
  assert.equal(typeof bot.TELEGRAM_UPDATE_RETENTION_DAYS, "number");
});

test("getTelegramBot without a token throws AppError 503", () => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_BOT_TOKEN;
  try {
    assert.throws(() => bot.getTelegramBot(), (error) => error instanceof AppError && error.status === 503);
  } finally {
    if (token !== undefined) process.env.TELEGRAM_BOT_TOKEN = token;
  }
});
