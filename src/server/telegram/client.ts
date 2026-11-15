import { Bot, type Context } from "grammy";
import { AppError } from "@/server/http";
import { registerPrivacyConsent } from "@/server/telegram/middleware";
import { registerCommands } from "@/server/telegram/handlers/commands";
import { registerCallbacks } from "@/server/telegram/handlers/callbacks";
import { registerMessages } from "@/server/telegram/handlers/messages";
import { sendExportWithApi } from "@/server/telegram/export";

let botInstance: Bot<Context> | undefined;

export function getBot(): Bot<Context> {
  if (botInstance) return botInstance;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new AppError(503, "Telegram ещё не настроен.");

  const bot = new Bot(token);
  registerPrivacyConsent(bot);
  registerCommands(bot, { sendExport: (telegramUserId) => sendExportWithApi(bot.api, telegramUserId) });
  registerCallbacks(bot);
  registerMessages(bot);

  bot.catch(() => {
    // Do not let grammY print request payloads, API URLs, or provider data.
    throw new Error("Telegram update handler failed");
  });

  botInstance = bot;
  return bot;
}

