import { InlineKeyboard, type Bot, type Context } from "grammy";
import type { InlineKeyboardButton } from "grammy/types";
import { ensureOwner, loadSnapshot } from "@/server/lifeos";
import * as schema from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { AppError } from "@/server/http";
import { normalizeModules, resolveFeatures } from "@/domain/modules";
import { buildHelpSection, buildStartMessage, HELP_MENU_TEXT, helpSections, isHelpSectionId } from "@/domain/welcome";
import { formatMoney, getAppUrl, isOwner } from "@/server/telegram/shared";
import { sendRequestedSummary } from "@/server/telegram/notifications";
import { enforceRateLimit, RATE_LIMITS } from "@/server/rate-limit";

export type CommandDeps = { sendExport: (telegramUserId: string) => Promise<void> };

export function registerCommands(bot: Bot<Context>, deps: CommandDeps): void {
  /** Enabled modules and features of the current owner, used to tailor start and help texts. */
  const welcomeInput = async () => {
    const owner = await ensureOwner();
    const modules = normalizeModules(owner.enabledModules);
    return { owner, input: { modules, features: resolveFeatures(modules, owner.disabledFeatures) } };
  };
  const appRow = () => {
    const appUrl = getAppUrl();
    return appUrl ? [InlineKeyboard.webApp("Открыть LifeOS", appUrl)] : [];
  };
  const helpMenuKeyboard = (input: Parameters<typeof helpSections>[0]) => {
    const buttons = helpSections(input).map((section) => InlineKeyboard.text(section.label, `help:${section.id}`));
    const rows: InlineKeyboardButton[][] = [];
    for (let index = 0; index < buttons.length; index += 2) rows.push(buttons.slice(index, index + 2));
    const app = appRow();
    if (app.length) rows.push(app);
    return new InlineKeyboard(rows);
  };

  bot.command("start", async (ctx) => {
    if (!(await isOwner(ctx)) || ctx.chat?.type !== "private") return;
    const appUrl = getAppUrl();
    if (!appUrl) {
      await ctx.reply("Веб-приложение пока не настроено.");
      return;
    }
    const { owner, input } = await welcomeInput();
    const [connected] = await getDb().select({ id: schema.aiProviderAccounts.id }).from(schema.aiProviderAccounts)
      .where(and(eq(schema.aiProviderAccounts.ownerId, owner.id), eq(schema.aiProviderAccounts.enabled, true))).limit(1);
    await ctx.reply(buildStartMessage({ ...input, firstRun: !owner.modulesConfigured, hasAi: !!connected }), {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard([appRow(), [InlineKeyboard.text("Сводка сегодня", "today")]]),
    });
  });

  bot.command("help", async (ctx) => {
    if (!(await isOwner(ctx)) || ctx.chat?.type !== "private") return;
    const { input } = await welcomeInput();
    await ctx.reply(HELP_MENU_TEXT, { parse_mode: "HTML", reply_markup: helpMenuKeyboard(input) });
  });

  // Help menu: each button swaps the message for one section, with a way back to the menu.
  bot.callbackQuery(/^help:([a-z]+)$/, async (ctx) => {
    if (!(await isOwner(ctx)) || ctx.chat?.type !== "private") {
      await ctx.answerCallbackQuery({ text: "Нет доступа." });
      return;
    }
    const target = ctx.match[1];
    const { input } = await welcomeInput();
    if (target === "menu") {
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(HELP_MENU_TEXT, { parse_mode: "HTML", reply_markup: helpMenuKeyboard(input) }).catch(() => undefined);
      return;
    }
    const text = isHelpSectionId(target) ? buildHelpSection(target, input) : null;
    if (!text) {
      await ctx.answerCallbackQuery({ text: "Этого раздела уже нет. Открой /help заново." });
      return;
    }
    await ctx.answerCallbackQuery();
    const rows: InlineKeyboardButton[][] = [[InlineKeyboard.text("‹ К справке", "help:menu")]];
    const app = appRow();
    if (app.length) rows.push(app);
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: new InlineKeyboard(rows) }).catch(() => undefined);
  });

  bot.command("today", async (ctx) => {
    if (!(await isOwner(ctx)) || ctx.chat?.type !== "private") return;
    await sendToday(ctx);
  });

  bot.command("summary", async (ctx) => {
    if (!(await isOwner(ctx)) || ctx.chat?.type !== "private") return;
    const period = ctx.match.trim() || "week";
    if (period !== "day" && period !== "week" && period !== "month") {
      await ctx.reply("Напиши /summary, /summary day, /summary week или /summary month.");
      return;
    }
    try {
      await enforceRateLimit(RATE_LIMITS.summary, ctx.from!.id);
      await sendRequestedSummary(period);
    } catch (error) {
      await ctx.reply(error instanceof AppError ? error.message : "Не удалось отправить сводку. Попробуй позже.");
    }
  });

  bot.command("export", async (ctx) => {
    if (!(await isOwner(ctx)) || ctx.chat?.type !== "private") return;
    try {
      await deps.sendExport(String(ctx.from?.id));
    } catch (error) {
      await ctx.reply(error instanceof AppError ? error.message : "Не удалось отправить копию данных. Попробуй позже.");
    }
  });

  bot.command("cancel", async (ctx) => {
    if (!(await isOwner(ctx)) || ctx.chat?.type !== "private") return;
    const owner = await ensureOwner();
    await getDb()
      .update(schema.ownerSettings)
      .set({ editingCaptureId: null, aiClarificationHistory: null, aiClarificationUpdatedAt: null, updatedAt: new Date() })
      .where(eq(schema.ownerSettings.id, owner.id));
    await ctx.reply("Хорошо, отменил исправление. Если нужно что-то записать, просто пришли новое сообщение.");
  });

  bot.callbackQuery("today", async (ctx) => {
    if (!(await isOwner(ctx)) || ctx.chat?.type !== "private") {
      await ctx.answerCallbackQuery({ text: "Нет доступа." });
      return;
    }
    await ctx.answerCallbackQuery();
    await sendToday(ctx);
  });
}

async function sendToday(ctx: Context): Promise<void> {
  try {
    const snapshot = await loadSnapshot();
    const lines = [`Вот что уже есть за сегодня · ${snapshot.localDate}`];
    const modules = snapshot.settings.enabledModules;
    const nutrition = snapshot.nutrition;
    if (modules.includes("nutrition")) {
      lines.push(`Питание: ${Math.round(nutrition.consumed.calories)} / ${nutrition.target ? Math.round(nutrition.target.calories) : "—"} ккал`);
      lines.push(`Б ${Math.round(nutrition.consumed.proteinGrams)} · Ж ${Math.round(nutrition.consumed.fatGrams)} · У ${Math.round(nutrition.consumed.carbsGrams)} г`);
      if (nutrition.target) {
        lines.push(`До цели по калориям осталось ${Math.max(0, Math.round(nutrition.target.calories - nutrition.consumed.calories))} ккал`);
      }
    }
    if (modules.includes("finance")) {
      lines.push(`Расходы: ${formatMoney(snapshot.finance.spentTodayMinor, snapshot.settings.baseCurrency)} сегодня · ${formatMoney(snapshot.finance.spentMonthMinor, snapshot.settings.baseCurrency)} за месяц`);
    }
    if (modules.includes("gym")) {
      if (snapshot.gym.nextWorkout) {
        const session = snapshot.activeSession ? "Текущая тренировка" : "Следующая тренировка";
        lines.push(`${session}: ${snapshot.gym.nextWorkout.name}`);
      } else if (snapshot.gym.lastWorkout) {
        lines.push(`Последняя тренировка: ${snapshot.gym.lastWorkout.name} · ${snapshot.gym.lastWorkout.summary}`);
      } else {
        lines.push("Зал: программа пока не составлена.");
      }
    }
    await ctx.reply(lines.join("\n"));
  } catch (error) {
    if (error instanceof AppError) await ctx.reply(error.message);
    else throw error;
  }
}
