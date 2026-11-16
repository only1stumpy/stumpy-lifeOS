import { InlineKeyboard, type Bot, type Context } from "grammy";
import { consentState, DELETE_CONFIRMATION_WORD, HEALTH_CONSENT_VERSION, PRIVACY_POLICY_URL, PRIVACY_POLICY_VERSION, TERMS_URL } from "@/domain/privacy";
import { executeCommand, ensureOwner } from "@/server/lifeos";

const POLICY_PROMPT =
  "Перед началом работы нужно подтвердить, что тебе есть 18 лет, и принять условия использования и политику конфиденциальности. Бот хранит твои записи о питании, финансах и тренировках, а ключи ИИ только в зашифрованном виде. Данные можно выгрузить командой /export или удалить командой /delete в любой момент, без согласия.";
const HEALTH_PROMPT =
  "Осталось отдельное согласие: вес, питание (КБЖУ) и тренировки могут считаться данными о здоровье. Без него LifeOS не сможет их обрабатывать. Согласие можно отозвать в Mini App (Настройки, Данные и приватность). Выгрузить данные (/export) или удалить их (/delete) можно и без согласия.";

function promptFor(state: "policy" | "health") {
  return state === "policy"
    ? { text: POLICY_PROMPT, markup: new InlineKeyboard().url("Политика конфиденциальности", PRIVACY_POLICY_URL).row().url("Условия использования", TERMS_URL).row().text("Мне 18+, принимаю", "privacy:accept") }
    : { text: HEALTH_PROMPT, markup: new InlineKeyboard().url("Политика конфиденциальности", PRIVACY_POLICY_URL).row().text("Согласен на данные о здоровье", "privacy:health") };
}

/** Nothing is stored or answered until the user has accepted the current policy and health consent; export and deletion stay open. */
export function registerPrivacyConsent(bot: Bot<Context>): void {
  // Data rights (export, deletion) never wait for consent.
  bot.command("delete", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    await ctx.reply(
      `Удаление необратимо: будут стёрты все твои записи, настройки и ключи ИИ. Сначала можно сделать копию командой /export. Для подтверждения нажми кнопку (в Mini App для этого нужно ввести слово ${DELETE_CONFIRMATION_WORD}).`,
      { reply_markup: new InlineKeyboard().text("Удалить всё навсегда", "account:delete").text("Отмена", "account:keep") },
    );
  });
  bot.callbackQuery("account:keep", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("Хорошо, ничего не удаляю.").catch(() => undefined);
  });
  bot.callbackQuery("account:delete", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    await executeCommand({ type: "account.delete", confirmation: DELETE_CONFIRMATION_WORD });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("Все твои данные удалены. Если захочешь вернуться, напиши боту заново: профиль создастся с нуля.").catch(() => undefined);
  });

  bot.use(async (ctx, next) => {
    if (ctx.chat?.type !== "private") return next();
    const data = ctx.callbackQuery?.data;
    if (data === "privacy:accept" || data === "privacy:health") {
      const owner = await ensureOwner();
      if (data === "privacy:accept") {
        await executeCommand({ type: "privacy.accept", version: PRIVACY_POLICY_VERSION, adultConfirmed: true });
      } else if (consentState(owner) !== "policy") {
        await executeCommand({ type: "privacy.health.accept", version: HEALTH_CONSENT_VERSION });
      }
      await ctx.answerCallbackQuery().catch(() => undefined);
      const after = consentState({ privacyPolicyVersion: data === "privacy:accept" ? PRIVACY_POLICY_VERSION : owner.privacyPolicyVersion, healthConsentVersion: data === "privacy:health" ? HEALTH_CONSENT_VERSION : owner.healthConsentVersion });
      if (after === "ok") {
        await ctx.reply("Спасибо, согласие записано. Можно писать боту или открыть приложение.");
      } else if (after === "health") {
        const prompt = promptFor("health");
        await ctx.reply(prompt.text, { reply_markup: prompt.markup });
      }
      return;
    }
    const owner = await ensureOwner();
    const state = consentState(owner);
    if (state === "ok") return next();
    // Export is a data right: it is served before consent.
    if (ctx.message?.text?.split(/[\s@]/)[0] === "/export") return next();
    const prompt = promptFor(state);
    await ctx.reply(prompt.text, { reply_markup: prompt.markup });
  });
}
