import { and, eq, sql } from "drizzle-orm";
import { InlineKeyboard, type Bot, type Context } from "grammy";
import * as schema from "@/db/schema";
import { getDb } from "@/db/client";
import { debtRemainingMinor } from "@/domain/debts";
import { executeCommand, ensureOwner, loadPendingDrafts } from "@/server/lifeos";
import { AppError } from "@/server/http";
import { formatBulkSummary, formatConfirmedRecords, formatRecurringConfirmation } from "@/server/telegram/confirmation";
import { clearEditingCapture, formatMoney, isOwner, markMessage } from "@/server/telegram/shared";

export function registerCallbacks(bot: Bot<Context>): void {
  bot.on("callback_query:data", async (ctx) => {
    if (!(await isOwner(ctx)) || ctx.chat?.type !== "private") {
      await ctx.answerCallbackQuery({ text: "Нет доступа." });
      return;
    }

    const [action, id, dueOn] = ctx.callbackQuery.data.split(":");
    if (!id) {
      await ctx.answerCallbackQuery({ text: "Кнопка устарела." });
      return;
    }

    try {
      if (action === "tgt") {
        if (id === "keep") {
          await ctx.answerCallbackQuery({ text: "Оставил прежнюю норму." });
          await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() }).catch(() => undefined);
          return;
        }
        const [calories, proteinGrams, fatGrams, carbsGrams] = id.split("-").map(Number);
        if (![calories, proteinGrams, fatGrams, carbsGrams].every((value) => Number.isFinite(value) && value >= 0) || calories <= 0) {
          await ctx.answerCallbackQuery({ text: "Кнопка устарела." });
          return;
        }
        const owner = await ensureOwner();
        await executeCommand({ type: "settings.save", timeZone: owner.timezone, target: { calories, proteinGrams, fatGrams, carbsGrams } });
        await ctx.answerCallbackQuery({ text: "Норма обновлена." });
        await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() }).catch(() => undefined);
        await ctx.reply(`Новая норма с сегодняшнего дня: ${calories} ккал · Б ${proteinGrams} · Ж ${fatGrams} · У ${carbsGrams} г. Поменять можно в «Цели КБЖУ» в LifeOS.`);
        return;
      }

      if (action === "all" || action === "none") {
        const owner = await ensureOwner();
        const pending = await getDb()
          .select({ id: schema.captureDrafts.id })
          .from(schema.captureDrafts)
          .where(and(eq(schema.captureDrafts.ownerId, owner.id), eq(schema.captureDrafts.telegramUpdateRowId, id), eq(schema.captureDrafts.status, "pending")));
        if (!pending.length) {
          await ctx.answerCallbackQuery({ text: "Здесь уже нечего подтверждать." });
          await markMessage(ctx, "Все черновики из этого сообщения уже обработаны.");
          return;
        }
        const messageIds = await getDb()
          .select({ id: schema.captureDrafts.id, messageId: schema.captureDrafts.telegramMessageId })
          .from(schema.captureDrafts)
          .where(and(eq(schema.captureDrafts.ownerId, owner.id), eq(schema.captureDrafts.telegramUpdateRowId, id), eq(schema.captureDrafts.status, "pending")));
        const messageIdOf = new Map(messageIds.map((row) => [row.id, row.messageId]));
        // The summary is built before confirming: confirmed drafts leave the snapshot.
        const described = new Map((await loadPendingDrafts([...messageIdOf.keys()])).map((draft) => [draft.id, draft]));
        const baseCurrency = owner.baseCurrency ?? "";
        const bulkMessageId = ctx.callbackQuery?.message?.message_id;
        const cleanup = async (draftIds: string[], removeBulk = true) => {
          const ids = draftIds.map((draftId) => messageIdOf.get(draftId)).filter((value): value is number => typeof value === "number");
          if (bulkMessageId && removeBulk) ids.push(bulkMessageId);
          await Promise.all(ids.map((messageId) => ctx.api.deleteMessage(ctx.chat?.id ?? ctx.callbackQuery?.message?.chat.id ?? 0, messageId).catch(() => undefined)));
        };

        if (action === "none") {
          for (const draft of pending) await executeCommand({ type: "draft.reject", id: draft.id });
          await ctx.answerCallbackQuery({ text: "Хорошо, отменил." });
          await ctx.reply(`Отменил черновики: ${pending.length}. Ничего не записывал.`);
          await cleanup(pending.map((draft) => draft.id));
          return;
        }
        const savedIds: string[] = [];
        const problems: string[] = [];
        for (const draft of pending) {
          try {
            await executeCommand({ type: "draft.confirm", id: draft.id });
            savedIds.push(draft.id);
          } catch (error) {
            if (!(error instanceof AppError) || error.status >= 500) throw error;
            if (!problems.includes(error.message)) problems.push(error.message);
          }
        }
        await ctx.answerCallbackQuery({ text: `Записал: ${savedIds.length} из ${pending.length}.` });
        await ctx.reply(formatBulkSummary(savedIds.map((draftId) => described.get(draftId)).filter((draft): draft is NonNullable<typeof draft> => !!draft), pending.length, problems, baseCurrency));
        // Drafts that failed keep their own message so they can still be fixed.
        // With failures the bulk message stays: its buttons still apply to the drafts that were not saved.
        await cleanup(savedIds, problems.length === 0);
        return;
      }

      if (action === "confirm") {
        await executeCommand({ type: "draft.confirm", id });
        await clearEditingCapture(id);
        const owner = await ensureOwner();
        const [food] = await getDb()
          .select({
            id: schema.nutritionEntries.id,
            name: schema.nutritionEntries.name,
            portionLabel: schema.nutritionEntries.portionLabel,
            calories: schema.nutritionEntries.calories,
            proteinGrams: schema.nutritionEntries.proteinGrams,
            fatGrams: schema.nutritionEntries.fatGrams,
            carbsGrams: schema.nutritionEntries.carbsGrams,
          })
          .from(schema.nutritionEntries)
          .where(and(eq(schema.nutritionEntries.ownerId, owner.id), eq(schema.nutritionEntries.captureDraftId, id)))
          .limit(1);
        const [money] = await getDb()
          .select({
            name: schema.financeEntries.name,
            entryType: schema.financeEntries.entryType,
            amount: schema.financeEntries.amount,
            currency: schema.financeEntries.currency,
          })
          .from(schema.financeEntries)
          .where(and(eq(schema.financeEntries.ownerId, owner.id), eq(schema.financeEntries.captureDraftId, id)))
          .limit(1);
        const [planRow] = await getDb()
          .select({ name: schema.moneyDrafts.name, amount: schema.moneyDrafts.amount })
          .from(schema.captureDrafts)
          .innerJoin(schema.moneyDrafts, eq(schema.moneyDrafts.captureDraftId, schema.captureDrafts.id))
          .where(and(eq(schema.captureDrafts.id, id), eq(schema.captureDrafts.ownerId, owner.id), eq(schema.captureDrafts.kind, "plan")))
          .limit(1);
        if (planRow) {
          await ctx.answerCallbackQuery({ text: "План записан." });
          await markMessage(ctx, "Запланировал «" + planRow.name + "» — " + formatMoney(Math.round(Number(planRow.amount) * 100), owner.baseCurrency ?? "") + ". Это пока не расход.");
          return;
        }
        const [debtDraft] = await getDb()
          .select()
          .from(schema.financeDebtDrafts)
          .where(and(eq(schema.financeDebtDrafts.ownerId, owner.id), eq(schema.financeDebtDrafts.captureDraftId, id)))
          .limit(1);
        if (debtDraft) {
          if (debtDraft.operation === "create") {
            const direction = debtDraft.direction === "i_owe"
              ? "Ты занял у " + debtDraft.personName
              : "Ты одолжил " + debtDraft.personName;
            const treatment = debtDraft.openedAs === "opening_balance"
              ? "Добавил текущий остаток старого долга"
              : "Записал новый долг и финансовую операцию";
            const lines = [treatment + ": " + direction + " · " + formatMoney(Math.round(Number(debtDraft.amount) * 100), owner.baseCurrency ?? "")];
            if (debtDraft.dueOn) lines.push("Срок возврата — " + debtDraft.dueOn + ".");
            await ctx.answerCallbackQuery({ text: "Долг записан." });
            await markMessage(ctx, lines.join("\n"));
            return;
          }
          if (!debtDraft.debtId) throw new AppError(404, "Запись долга не найдена.");
          const [record] = await getDb().select().from(schema.financeDebts)
            .where(and(eq(schema.financeDebts.id, debtDraft.debtId), eq(schema.financeDebts.ownerId, owner.id))).limit(1);
          if (!record) throw new AppError(404, "Долг не найден.");
          const repayments = await getDb().select().from(schema.financeDebtRepayments)
            .where(and(eq(schema.financeDebtRepayments.debtId, record.id), eq(schema.financeDebtRepayments.ownerId, owner.id)));
          const remaining = debtRemainingMinor(Math.round(Number(record.originalAmount) * 100), repayments.map((row) => Math.round(Number(row.amount) * 100)));
          const actionText = debtDraft.direction === "i_owe" ? "Вернул " + debtDraft.personName : debtDraft.personName + " вернул тебе";
          await ctx.answerCallbackQuery({ text: "Возврат записан." });
          await markMessage(ctx, "Записал: " + actionText + " · " + formatMoney(Math.round(Number(debtDraft.amount) * 100), owner.baseCurrency ?? "") + "\nОстаток долга: " + formatMoney(remaining, owner.baseCurrency ?? ""));
          return;
        }
        const confirmation = formatConfirmedRecords({
          food: food ?? null,
          money: money ? { ...money, entryType: money.entryType as "expense" | "income", currency: money.currency } : null,
        });
        await ctx.answerCallbackQuery({ text: confirmation.callbackText });
        await markMessage(ctx, confirmation.messageText);
        if (food) {
          const repeats = await getDb()
            .select({ id: schema.nutritionEntries.id })
            .from(schema.nutritionEntries)
            .where(and(eq(schema.nutritionEntries.ownerId, owner.id), sql`lower(${schema.nutritionEntries.name}) = lower(${food.name})`))
            .limit(2);
          const [template] = await getDb()
            .select({ id: schema.foodTemplates.id })
            .from(schema.foodTemplates)
            .where(and(eq(schema.foodTemplates.ownerId, owner.id), sql`lower(${schema.foodTemplates.name}) = lower(${food.name})`))
            .limit(1);
          if (repeats.length >= 2 && !template) {
            await ctx.reply("Вижу, это блюдо уже было. Запомнить его как твою обычную порцию?", {
              reply_markup: new InlineKeyboard().text("Запомнить блюдо", `template:${food.id}`),
            });
          }
        }
        return;
      }

      if (action === "cancel") {
        await executeCommand({ type: "draft.reject", id });
        await clearEditingCapture(id);
        await ctx.answerCallbackQuery({ text: "Хорошо, отменил." });
        await markMessage(ctx, "Хорошо, черновик отменён. Ничего не записывал.");
        return;
      }

      if (action === "edit") {
        const owner = await ensureOwner();
        await getDb()
          .update(schema.ownerSettings)
          .set({ editingCaptureId: id, updatedAt: new Date() })
          .where(eq(schema.ownerSettings.id, owner.id));
        await ctx.answerCallbackQuery();
        await markMessage(ctx, "Напиши следующим сообщением, что поправить — например, «гречки две тарелки, мяса вдвое меньше». Если передумал, отправь /cancel.");
        return;
      }

      if (action === "template") {
        const owner = await ensureOwner();
        const [food] = await getDb()
          .select({ name: schema.nutritionEntries.name })
          .from(schema.nutritionEntries)
          .where(and(eq(schema.nutritionEntries.ownerId, owner.id), eq(schema.nutritionEntries.id, id)))
          .limit(1);
        if (!food) throw new AppError(404, "Запись еды не найдена.");
        await executeCommand({ type: "template.save", foodEntryId: id, name: food.name });
        await ctx.answerCallbackQuery({ text: "Блюдо запомнено." });
        await markMessage(ctx, "Готово, сохранил блюдо как обычную порцию. В следующий раз записать его будет быстрее.");
        return;
      }

      if (action === "pay") {
        const owner = await ensureOwner();
        const [payment] = await getDb()
          .select({ name: schema.recurringPayments.name, amount: schema.recurringPayments.amount, currency: schema.recurringPayments.currency })
          .from(schema.recurringPayments)
          .where(and(eq(schema.recurringPayments.id, id), eq(schema.recurringPayments.ownerId, owner.id)))
          .limit(1);
        if (!payment) throw new AppError(404, "Платёж не найден.");
        await executeCommand({ type: "recurring.confirm", id, dueOn });
        const confirmation = formatRecurringConfirmation({
          ...payment,
          amount: payment.amount,
          currency: payment.currency,
        });
        await ctx.answerCallbackQuery({ text: confirmation.callbackText });
        await markMessage(ctx, confirmation.messageText);
        return;
      }

      await ctx.answerCallbackQuery({ text: "Неизвестная кнопка." });
    } catch (error) {
      const message = error instanceof AppError ? error.message : "Не удалось выполнить действие. Попробуй ещё раз.";
      await ctx.answerCallbackQuery({ text: message.slice(0, 180) }).catch(() => undefined);
      await ctx.reply(message).catch(() => undefined);
      if (!(error instanceof AppError) || error.status >= 500) throw new Error("Telegram callback handler failed");
    }
  });
}
