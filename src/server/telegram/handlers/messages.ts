import { and, desc, eq, lt } from "drizzle-orm";
import type { Bot, Context } from "grammy";
import * as schema from "@/db/schema";
import { getDb } from "@/db/client";
import { commandSchema } from "@/domain/commands";
import { dateKey, weightDateToStamp, weightStampToDate } from "@/domain/math";
import { hasFinancePlanMarker, parseFinancePlanMessage } from "@/domain/finance-plans";
import { foreignCurrencyQuestion, rubleMarkerContradictsBase } from "@/domain/currencies";
import { parseDebtMessage } from "@/domain/debt-message";
import { parseWeightMessage } from "@/domain/weight-message";
import { disabledFeatureMessage, disabledModulesMessage, normalizeModules, resolveFeatures } from "@/domain/modules";
import { executeCommand, ensureOwner, analyzeCapture, createDebtCaptureDraft, loadSnapshot, loadPendingDrafts } from "@/server/lifeos";
import { answerKnownReferenceQuestion, isReferenceQuestion, makeReferenceContext } from "@/server/telegram/reference";
import { answerLifeOSQuestion } from "@/server/ai/analyze";
import { AppError } from "@/server/http";
import { AIAnalysisError } from "@/server/ai/types";
import { loadConfiguredAiProviderConfigs } from "@/server/ai/provider-accounts";
import { clearEditingCapture, formatMoney, formatSigned, isOwner, round1, updateRowIds } from "@/server/telegram/shared";
import { downloadTelegramPhoto } from "@/server/telegram/handlers/photo";
import { bulkDraftKeyboard, formatDraftList, sendDraftMessage, replyInParts } from "@/server/telegram/handlers/drafts";

const MAX_SEPARATE_DRAFT_MESSAGES = 5;

export function registerMessages(bot: Bot<Context>): void {
  bot.on("message", async (ctx) => {
    if (!(await isOwner(ctx)) || ctx.chat?.type !== "private") return;
    if (!("message" in ctx.update)) return;
    const message = ctx.update.message;
    const text = "text" in message && typeof message.text === "string"
      ? message.text
      : "caption" in message && typeof message.caption === "string"
        ? message.caption
        : "";
    const photoSizes = "photo" in message && Array.isArray(message.photo) ? message.photo : undefined;
    const photo = photoSizes?.reduce((largest, candidate) =>
      candidate.width * candidate.height > largest.width * largest.height ? candidate : largest,
    );
    if (!text.trim() && !photo) {
      await ctx.reply("Я умею разбирать текст и фото еды, этикетки или чека. Пришли одно из них — посмотрим, что получится записать.");
      return;
    }

    const owner = await ensureOwner();
    const previousDraftId = owner.editingCaptureId ?? undefined;
    let statusMessageId: number | undefined;
    let image: { mimeType: string; dataBase64: string } | undefined;

    try {
      const modules = normalizeModules(owner.enabledModules);
      const features = resolveFeatures(modules, owner.disabledFeatures);
      const weightKg = photo ? null : parseWeightMessage(text);
      if (weightKg !== null) {
        await ctx.reply(features.includes("nutrition.weight")
          ? await saveWeightFromChat(owner.id, owner.timezone, weightKg)
          : modules.includes("nutrition") ? disabledFeatureMessage("nutrition.weight") : disabledModulesMessage(["nutrition"]));
        return;
      }

      if (!photo && text.trim() && isReferenceQuestion(text)) {
        const snapshot = await loadSnapshot();
        // Ready-made answers read finance data directly, so they are skipped when finance is off.
        const knownAnswer = modules.includes("finance") ? answerKnownReferenceQuestion(text, snapshot) : null;
        if (knownAnswer) {
          await ctx.reply(knownAnswer);
          return;
        }

        // A pending correction keeps its editing context. Direct factual queries above are still answered.
        if (!previousDraftId) {
          const status = await ctx.reply("Сверяюсь с твоими данными и подбираю ответ…");
          statusMessageId = status.message_id;
          const providerProfiles = await loadConfiguredAiProviderConfigs(owner.id);
          const result = await answerLifeOSQuestion({ question: text, context: makeReferenceContext(snapshot) }, {
            profiles: providerProfiles,
            ownerId: owner.id,
          });
          await ctx.api.deleteMessage(ctx.chat.id, statusMessageId).catch(() => undefined);
          statusMessageId = undefined;
          await ctx.reply(result.answer);
          return;
        }
      }

      if (!photo && !modules.includes("finance") && (hasFinancePlanMarker(text) || parseDebtMessage(text))) {
        await ctx.reply(disabledModulesMessage(["finance"]));
        return;
      }
      if (!photo && !features.includes("finance.plans") && hasFinancePlanMarker(text)) {
        await ctx.reply(disabledFeatureMessage("finance.plans"));
        return;
      }
      if (!photo && !features.includes("finance.debts") && parseDebtMessage(text)) {
        await ctx.reply(disabledFeatureMessage("finance.debts"));
        return;
      }

      if (!photo && (hasFinancePlanMarker(text) || parseDebtMessage(text)) && rubleMarkerContradictsBase(text, owner.baseCurrency)) {
        await ctx.reply(foreignCurrencyQuestion(owner.baseCurrency ?? ""));
        return;
      }

      if (!photo && hasFinancePlanMarker(text)) {
        const plan = parseFinancePlanMessage(text);
        if (!plan) {
          await ctx.reply("Не разобрал название или цену. Напиши, например: «Запиши в планы шампунь за 220р». План не влияет на расходы, пока не отметишь покупку.");
          return;
        }

        const command = commandSchema.parse({ type: "finance-plan.save", ...plan });
        // The same Telegram update (a retry) must not add the plan twice.
        const updateRowId = updateRowIds.get(ctx.update);
        await executeCommand(command, updateRowId ? { requestId: `update:${updateRowId}:plan` } : {});
        await ctx.reply(`Запланировал «${plan.name}» — ${formatMoney(plan.amountMinor, owner.baseCurrency ?? "")}. Это пока не расход.`);
        return;
      }

      if (!photo) {
        const debtIntent = parseDebtMessage(text);
        if (debtIntent) {
          const result = await createDebtCaptureDraft({
            intent: debtIntent,
            messageText: text.trim(),
            telegramUpdateRowId: updateRowIds.get(ctx.update),
          });
          if (!result.draftIds.length) {
            await ctx.reply(result.clarification ?? "Не получилось сопоставить долг. Открой «Финансы → Долги» и выбери запись вручную.");
            return;
          }
          const [draft] = await loadPendingDrafts([result.draftIds[0]]);
          if (!draft) throw new AppError(404, "Черновик долга не найден.");
          await sendDraftMessage(ctx, draft, owner.timezone, owner.baseCurrency ?? "");
          return;
        }
      }

      if (previousDraftId && !photo && text.trim() && await isUncategorizedPendingMoneyDraft(owner.id, previousDraftId)) {
        const categoryCommand = commandSchema.safeParse({
          type: "draft.money-category.set",
          id: previousDraftId,
          category: text.trim(),
        });
        if (!categoryCommand.success) throw new AppError(400, "Название категории должно быть не длиннее 300 символов.");
        await executeCommand(categoryCommand.data);
        await clearEditingCapture(previousDraftId);
        const [draft] = await loadPendingDrafts([previousDraftId]);
        if (!draft) throw new AppError(404, "Обновлённый черновик не найден.");
        await sendDraftMessage(ctx, draft, owner.timezone, owner.baseCurrency ?? "");
        return;
      }

      if (photo) {
        const status = await ctx.reply("Смотрю фото…");
        statusMessageId = status.message_id;
        image = await downloadTelegramPhoto(ctx, photo.file_id);
      } else {
        const status = await ctx.reply("Разбираю сообщение…");
        statusMessageId = status.message_id;
      }

      const updateRowId = updateRowIds.get(ctx.update);
      const result = await analyzeCapture({
        text,
        image,
        previousDraftId,
        telegramUpdateRowId: updateRowId,
        // A retried update keeps the time the user wrote it, not the time of the retry.
        messageAt: ctx.message?.date ? new Date(ctx.message.date * 1000) : undefined,
      });

      if (previousDraftId && result.draftIds.length) await clearEditingCapture(previousDraftId);
      if (statusMessageId) {
        await ctx.api.editMessageText(ctx.chat.id, statusMessageId, "Сверяю детали перед записью…").catch(() => undefined);
      }

      if (!result.draftIds.length) {
        if (statusMessageId) await ctx.api.deleteMessage(ctx.chat.id, statusMessageId).catch(() => undefined);
        await ctx.reply(result.clarification ?? "Подскажи, пожалуйста, чуть подробнее, что именно нужно записать.");
        return;
      }

      if (statusMessageId) {
        await ctx.api.editMessageText(ctx.chat.id, statusMessageId, "Готовлю отдельные черновики для подтверждения…").catch(() => undefined);
      }
      const drafts = await loadPendingDrafts(result.draftIds);
      if (statusMessageId) await ctx.api.deleteMessage(ctx.chat.id, statusMessageId).catch(() => undefined);
      const moneyOnly = drafts.every((draft) => draft.money && !draft.food && !draft.debt);
      if (updateRowId && moneyOnly && drafts.length > MAX_SEPARATE_DRAFT_MESSAGES) {
        // A long receipt would flood the chat with one message per item; list it once with bulk actions.
        await replyInParts(ctx, formatDraftList(drafts), bulkDraftKeyboard(updateRowId));
      } else {
        for (const draft of drafts) {
          await sendDraftMessage(ctx, draft, owner.timezone, owner.baseCurrency ?? "");
        }
        if (updateRowId && drafts.length > 1) {
          await ctx.reply(`Черновиков: ${drafts.length}. Можно подтвердить каждый отдельно или все разом.`, { reply_markup: bulkDraftKeyboard(updateRowId) });
        }
      }
      if (result.clarification) await ctx.reply(result.clarification);
    } catch (error) {
      if (statusMessageId) await ctx.api.deleteMessage(ctx.chat.id, statusMessageId).catch(() => undefined);
      const messageText = error instanceof AppError || error instanceof AIAnalysisError
        ? error.message
        : "Не получилось разобрать сообщение. Попробуй ещё раз или напиши, что съел или купил и сколько это стоило.";
      await ctx.reply(messageText);
      // The user has been told about the failure: replaying the update would repeat the AI call and the reply.
      // Only a failed reply (thrown above) leaves the update for a retry.
    }
  });
}

/** Records today's body weight without AI and compares it with the previous measurement. */
async function saveWeightFromChat(ownerId: string, timeZone: string, weightKg: number): Promise<string> {
  const today = dateKey(new Date(), timeZone);
  const [previous] = await getDb().select().from(schema.weightEntries)
    .where(and(eq(schema.weightEntries.ownerId, ownerId), lt(schema.weightEntries.occurredAt, weightDateToStamp(today))))
    .orderBy(desc(schema.weightEntries.occurredAt))
    .limit(1);
  await executeCommand(commandSchema.parse({ type: "weight.save", date: today, weightKg }));
  const lines = [`Записал вес ${round1(weightKg)} кг на сегодня.`];
  if (previous) {
    const [, month, day] = weightStampToDate(previous.occurredAt).split("-");
    const delta = weightKg - Number(previous.weightKg);
    lines.push(`Прошлый замер ${day}.${month}: ${round1(Number(previous.weightKg))} кг${Math.abs(delta) >= 0.05 ? ` (${formatSigned(delta)} кг)` : ", без изменений"}.`);
  }
  lines.push("Ошибся — пришли правильный вес, он заменит сегодняшний.");
  return lines.join("\n");
}

async function isUncategorizedPendingMoneyDraft(ownerId: string, draftId: string): Promise<boolean> {
  const [draft] = await getDb().select({ id: schema.captureDrafts.id })
    .from(schema.captureDrafts)
    .where(and(
      eq(schema.captureDrafts.id, draftId),
      eq(schema.captureDrafts.ownerId, ownerId),
      eq(schema.captureDrafts.status, "pending"),
    ))
    .limit(1);
  if (!draft) return false;

  const [money] = await getDb().select({
    categoryId: schema.moneyDrafts.categoryId,
    proposedCategory: schema.moneyDrafts.proposedCategory,
  })
    .from(schema.moneyDrafts)
    .where(and(
      eq(schema.moneyDrafts.captureDraftId, draftId),
      eq(schema.moneyDrafts.ownerId, ownerId),
    ))
    .limit(1);
  return Boolean(money && !money.categoryId && !money.proposedCategory);
}
