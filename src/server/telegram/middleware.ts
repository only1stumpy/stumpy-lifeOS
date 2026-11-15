import { InlineKeyboard, type Bot, type Context } from "grammy";
import { PRIVACY_POLICY_URL, PRIVACY_POLICY_VERSION } from "@/domain/privacy";
import { executeCommand, ensureOwner } from "@/server/lifeos";

/** Nothing is stored or answered until the user has accepted the current privacy policy. */
export function registerPrivacyConsent(bot: Bot<Context>): void {
  // Nothing is stored or answered until the user has accepted the current privacy policy.
  bot.use(async (ctx, next) => {
    if (ctx.chat?.type !== "private") return next();
    const owner = await ensureOwner();
    if (owner.privacyPolicyVersion === PRIVACY_POLICY_VERSION) return next();
    if (ctx.callbackQuery?.data === "privacy:accept") {
      await executeCommand({ type: "privacy.accept", version: PRIVACY_POLICY_VERSION });
      await ctx.answerCallbackQuery().catch(() => undefined);
      await ctx.reply("Спасибо, согласие записано. Можно писать боту или открыть приложение.");
      return;
    }
    await ctx.reply(
      "Перед началом работы нужно принять политику конфиденциальности. Бот хранит ваши записи о питании, финансах и тренировках, а ключи ИИ только в зашифрованном виде. Данные можно выгрузить или удалить в любой момент: Mini App, Настройки, Данные и приватность.",
      { reply_markup: new InlineKeyboard().url("Политика конфиденциальности", PRIVACY_POLICY_URL).row().text("Принимаю", "privacy:accept") },
    );
  });
}
