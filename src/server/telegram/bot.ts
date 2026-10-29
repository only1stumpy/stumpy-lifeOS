import { and, eq, lt, or, sql } from "drizzle-orm";
import { Bot, InlineKeyboard, type Context } from "grammy";
import type { InlineKeyboardMarkup, Update } from "grammy/types";
import * as schema from "@/db/schema";
import { getDb } from "@/db/client";
import { commandSchema } from "@/domain/commands";
import { dateKey, sumMacros, convertToLocalMinor } from "@/domain/math";
import { executeCommand, ensureOwner, analyzeCapture, loadSnapshot } from "@/server/lifeos";
import { answerKnownReferenceQuestion, isReferenceQuestion, makeReferenceContext } from "@/server/telegram/reference";
import { answerLifeOSQuestion } from "@/server/ai/analyze";
import { AppError } from "@/server/http";
import { AIAnalysisError } from "@/server/ai/types";
import { formatConfirmedRecords, formatRecurringConfirmation } from "@/server/telegram/confirmation";

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const TELEGRAM_FILE_TIMEOUT_MS = 20_000;
const MAX_UPDATE_ATTEMPTS = 3;

let botInstance: Bot<Context> | undefined;
let botInitialization: Promise<void> | undefined;
const updateRowIds = new WeakMap<object, string>();

function getBot(): Bot<Context> {
  if (botInstance) return botInstance;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new AppError(503, "Telegram ещё не настроен.");

  const bot = new Bot(token);
  bot.command("start", async (ctx) => {
    if (!(await isOwner(ctx)) || ctx.chat?.type !== "private") return;
    const appUrl = getAppUrl();
    if (!appUrl) {
      await ctx.reply("Веб-приложение пока не настроено.");
      return;
    }
    const keyboard = new InlineKeyboard()
      .webApp("Открыть LifeOS", appUrl)
      .row()
      .text("Сводка сегодня", "today");
    await ctx.reply("Привет! Просто напиши, что съел или купил, — я подготовлю черновик и покажу его перед записью. Можно отправить фото еды или этикетки; порцию достаточно описать примерно.", {
      reply_markup: keyboard,
    });
  });

  bot.command("today", async (ctx) => {
    if (!(await isOwner(ctx)) || ctx.chat?.type !== "private") return;
    await sendToday(ctx);
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

  bot.on("callback_query:data", async (ctx) => {
    if (!(await isOwner(ctx)) || ctx.chat?.type !== "private") {
      await ctx.answerCallbackQuery({ text: "Нет доступа." });
      return;
    }

    const [action, id] = ctx.callbackQuery.data.split(":");
    if (!id) {
      await ctx.answerCallbackQuery({ text: "Кнопка устарела." });
      return;
    }

    try {
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
        const confirmation = formatConfirmedRecords({
          food: food ?? null,
          money: money ? { ...money, entryType: money.entryType as "expense" | "income", currency: money.currency as "PRB" | "USD" } : null,
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
        await executeCommand({ type: "recurring.confirm", id });
        const confirmation = formatRecurringConfirmation({
          ...payment,
          amount: payment.amount,
          currency: payment.currency as "PRB" | "USD",
        });
        await ctx.answerCallbackQuery({ text: confirmation.callbackText });
        await markMessage(ctx, confirmation.messageText);
        return;
      }

      await ctx.answerCallbackQuery({ text: "Неизвестная кнопка." });
    } catch (error) {
      const message = error instanceof AppError ? error.message : "Не удалось выполнить действие. Попробуйте ещё раз.";
      await ctx.answerCallbackQuery({ text: message.slice(0, 180) }).catch(() => undefined);
      await ctx.reply(message).catch(() => undefined);
      if (!(error instanceof AppError) || error.status >= 500) throw new Error("Telegram callback handler failed");
    }
  });

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
      await ctx.reply("Я умею разбирать текст и фото еды или этикетки. Пришли одно из них — посмотрим, что получится записать.");
      return;
    }

    const owner = await ensureOwner();
    const previousDraftId = owner.editingCaptureId ?? undefined;
    let statusMessageId: number | undefined;
    let image: { mimeType: string; dataBase64: string } | undefined;

    try {
      if (!photo && text.trim() && isReferenceQuestion(text)) {
        const snapshot = await loadSnapshot();
        const knownAnswer = answerKnownReferenceQuestion(text, snapshot);
        if (knownAnswer) {
          await ctx.reply(knownAnswer);
          return;
        }

        // A pending correction keeps its editing context. Direct factual queries above are still answered.
        if (!previousDraftId) {
          const status = await ctx.reply("Сверяюсь с твоими данными и подбираю ответ…");
          statusMessageId = status.message_id;
          const result = await answerLifeOSQuestion({ question: text, context: makeReferenceContext(snapshot) });
          await ctx.api.deleteMessage(ctx.chat.id, statusMessageId).catch(() => undefined);
          statusMessageId = undefined;
          await ctx.reply(result.answer);
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
        const snapshot = await loadSnapshot();
        const draft = snapshot.drafts.find((item) => item.id === previousDraftId);
        if (!draft) throw new AppError(404, "Обновлённый черновик не найден.");
        await ctx.reply(formatDraft(draft, owner.timezone), { reply_markup: draftKeyboard(draft.id) });
        return;
      }

      if (photo) {
        const status = await ctx.reply("Смотрю фото и оцениваю порцию…");
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
      const snapshot = await loadSnapshot();
      const drafts = snapshot.drafts.filter((draft) => result.draftIds.includes(draft.id));
      if (statusMessageId) await ctx.api.deleteMessage(ctx.chat.id, statusMessageId).catch(() => undefined);
      for (const draft of drafts) {
        await ctx.reply(formatDraft(draft, owner.timezone), { reply_markup: draftKeyboard(draft.id) });
      }
    } catch (error) {
      if (statusMessageId) await ctx.api.deleteMessage(ctx.chat.id, statusMessageId).catch(() => undefined);
      const messageText = error instanceof AppError || error instanceof AIAnalysisError
        ? error.message
        : "Не получилось разобрать сообщение. Попробуй ещё раз или напиши, что съел или купил и сколько это стоило.";
      await ctx.reply(messageText);
      if (error instanceof AppError && error.status < 500) return;
      // Expected AI errors were already reported to the user; replaying the update would repeat the same AI call and reply.
      if (error instanceof AIAnalysisError) return;
      // The caller records unexpected failures so a persisted Telegram update can be retried.
      throw error;
    }
  });

  bot.catch(() => {
    // Do not let grammY print request payloads, API URLs, or provider data.
    throw new Error("Telegram update handler failed");
  });

  botInstance = bot;
  return bot;
}

export function getTelegramBot(): Bot<Context> {
  return getBot();
}

export function configuredOwnerId(): number {
  const value = process.env.TELEGRAM_OWNER_ID;
  if (!value || !/^[1-9]\d*$/.test(value)) throw new AppError(503, "Telegram ещё не настроен.");
  const id = Number(value);
  if (!Number.isSafeInteger(id)) throw new AppError(503, "Telegram ещё не настроен.");
  return id;
}

export async function sendOwnerMessage(
  text: string,
  replyMarkup?: InlineKeyboardMarkup,
): Promise<void> {
  const ownerId = configuredOwnerId();
  await getBot().api.sendMessage(ownerId, text, replyMarkup ? { reply_markup: replyMarkup } : {});
}

async function sendToday(ctx: Context): Promise<void> {
  try {
    const snapshot = await loadSnapshot();
    const lines = [`Вот что уже есть за сегодня · ${snapshot.localDate}`];
    const nutrition = snapshot.nutrition;
    lines.push(`Питание: ${Math.round(nutrition.consumed.calories)} / ${nutrition.target ? Math.round(nutrition.target.calories) : "—"} ккал`);
    lines.push(`Б ${Math.round(nutrition.consumed.proteinGrams)} · Ж ${Math.round(nutrition.consumed.fatGrams)} · У ${Math.round(nutrition.consumed.carbsGrams)} г`);
    if (nutrition.target) {
      lines.push(`До цели по калориям осталось ${Math.max(0, Math.round(nutrition.target.calories - nutrition.consumed.calories))} ккал`);
    }
    lines.push(`Расходы: ${formatMoney(snapshot.finance.spentTodayPrbMinor, "PRB")} сегодня · ${formatMoney(snapshot.finance.spentMonthPrbMinor, "PRB")} за месяц`);
    if (snapshot.gym.nextWorkout) {
      const session = snapshot.activeSession ? "Текущая тренировка" : "Следующая тренировка";
      lines.push(`${session}: ${snapshot.gym.nextWorkout.name}`);
    } else if (snapshot.gym.lastWorkout) {
      lines.push(`Последняя тренировка: ${snapshot.gym.lastWorkout.name} · ${snapshot.gym.lastWorkout.summary}`);
    } else {
      lines.push("Зал: программа пока не составлена.");
    }
    await ctx.reply(lines.join("\n"));
  } catch (error) {
    if (error instanceof AppError) await ctx.reply(error.message);
    else throw error;
  }
}

async function handlePhotoMessage(
  ctx: Context,
  fileId: string,
): Promise<{ mimeType: string; dataBase64: string }> {
  const file = await ctx.api.getFile(fileId);
  if (!file.file_path) throw new AppError(400, "Не удалось получить фотографию из Telegram.");
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new AppError(503, "Telegram ещё не настроен.");

  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`, {
      signal: AbortSignal.timeout(TELEGRAM_FILE_TIMEOUT_MS),
    });
  } catch {
    throw new AppError(503, "Фотография временно недоступна. Попробуйте ещё раз.");
  }
  if (!response.ok || !response.body) throw new AppError(503, "Фотография временно недоступна. Попробуйте ещё раз.");
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_PHOTO_BYTES) throw new AppError(413, "Фотография больше 8 МБ. Отправьте снимок меньшего размера.");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PHOTO_BYTES) {
        await reader.cancel();
        throw new AppError(413, "Фотография больше 8 МБ. Отправьте снимок меньшего размера.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (size === 0) throw new AppError(400, "Фотография пустая.");
  return { mimeType: "image/jpeg", dataBase64: Buffer.concat(chunks).toString("base64") };
}

async function downloadTelegramPhoto(ctx: Context, fileId: string) {
  try {
    return await handlePhotoMessage(ctx, fileId);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(503, "Фотографию не удалось обработать. Попробуйте отправить её ещё раз.");
  }
}

function formatDraft(
  draft: {
    occurredAt: string;
    food: { label: string; portionLabel: string; calories: number; proteinGrams: number; fatGrams: number; carbsGrams: number; estimated: boolean } | null;
    money: { label: string; amountMinor: number; currency: "PRB" | "USD"; kind: "expense" | "income"; category: string | null } | null;
  },
  timeZone: string,
): string {
  let time: string;
  try {
    time = new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(draft.occurredAt));
  } catch {
    time = draft.occurredAt;
  }
  const lines = [`Проверь, пожалуйста · ${time}`];
  if (draft.food) {
    lines.push(`Еда: ${draft.food.label} · ${draft.food.portionLabel}`);
    lines.push(`КБЖУ: ${Math.round(draft.food.calories)} ккал · Б ${round1(draft.food.proteinGrams)} · Ж ${round1(draft.food.fatGrams)} · У ${round1(draft.food.carbsGrams)} г`);
    if (draft.food.estimated) lines.push("КБЖУ оценены примерно.");
  }
  if (draft.money) {
    lines.push(`${draft.money.kind === "income" ? "Доход" : "Расход"}: ${draft.money.label} · ${formatMoney(draft.money.amountMinor, draft.money.currency)}`);
    lines.push(draft.money.category ? `Категория: ${draft.money.category}` : "Категорию пока не распознал — выбери её через «Исправить».");
  }
  return lines.join("\n");
}

function draftKeyboard(id: string) {
  return new InlineKeyboard()
    .text("Записать", `confirm:${id}`)
    .text("Исправить", `edit:${id}`)
    .row()
    .text("Отменить", `cancel:${id}`);
}

function formatMoney(amountMinor: number, currency: "PRB" | "USD"): string {
  const amount = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amountMinor / 100);
  return currency === "PRB" ? `${amount} руб. ПМР` : `${amount} USD`;
}

function round1(value: number): string {
  return (Math.round(value * 10) / 10).toLocaleString("ru-RU");
}

function formatSigned(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded.toLocaleString("ru-RU")}`;
}

async function isOwner(ctx: Context): Promise<boolean> {
  const ownerId = process.env.TELEGRAM_OWNER_ID;
  const fromId = ctx.from?.id;
  return Boolean(ownerId && fromId && String(fromId) === ownerId);
}

function getAppUrl(): string | null {
  const value = process.env.APP_URL?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function handlePersistedUpdate(update: Update, updateRowId: string): Promise<void> {
  updateRowIds.set(update, updateRowId);
  try {
    const bot = getBot();
    if (!botInitialization) {
      botInitialization = bot.init().then(() => undefined).catch((error: unknown) => {
        botInitialization = undefined;
        throw error;
      });
    }
    await botInitialization;
    await bot.handleUpdate(update);
  } finally {
    updateRowIds.delete(update);
  }
}

export async function processStoredTelegramUpdate(updateRowId: string): Promise<void> {
  const db = getDb();
  const [row] = await db.select().from(schema.telegramUpdates).where(eq(schema.telegramUpdates.id, updateRowId)).limit(1);
  if (!row || row.status === "processed" || row.attemptCount >= MAX_UPDATE_ATTEMPTS) return;

  const [claimed] = await db
    .update(schema.telegramUpdates)
    .set({ status: "processing", processingStartedAt: new Date(), attemptCount: sql`${schema.telegramUpdates.attemptCount} + 1`, lastError: null })
    .where(and(eq(schema.telegramUpdates.id, updateRowId), or(eq(schema.telegramUpdates.status, "received"), eq(schema.telegramUpdates.status, "failed"))))
    .returning();
  if (!claimed) return;

  try {
    await handlePersistedUpdate(claimed.payload as unknown as Update, updateRowId);
    await db
      .update(schema.telegramUpdates)
      .set({ status: "processed", processingStartedAt: null, payload: {}, processedAt: new Date(), lastError: null })
      .where(eq(schema.telegramUpdates.id, updateRowId));
  } catch {
    await db
      .update(schema.telegramUpdates)
      .set({ status: "failed", processingStartedAt: null, lastError: "handler_failed" })
      .where(eq(schema.telegramUpdates.id, updateRowId));
  }
}

export async function retryFailedTelegramUpdates(): Promise<void> {
  const db = getDb();
  await db
    .update(schema.telegramUpdates)
    .set({ status: "failed", processingStartedAt: null, lastError: "processing_timeout" })
    .where(and(
      eq(schema.telegramUpdates.status, "processing"),
      lt(schema.telegramUpdates.processingStartedAt, new Date(Date.now() - 120_000)),
    ));
  const rows = await db
    .select({ id: schema.telegramUpdates.id })
    .from(schema.telegramUpdates)
    .where(and(
      or(eq(schema.telegramUpdates.status, "received"), eq(schema.telegramUpdates.status, "failed")),
      sql`${schema.telegramUpdates.attemptCount} < ${MAX_UPDATE_ATTEMPTS}`,
    ))
    .orderBy(schema.telegramUpdates.receivedAt)
    .limit(5);
  for (const row of rows) await processStoredTelegramUpdate(row.id);
}

export async function sendDeduplicatedOwnerNotification(
  key: string,
  text: string,
  replyMarkup?: InlineKeyboardMarkup,
): Promise<boolean> {
  const owner = await ensureOwner();
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx
      .insert(schema.notificationDeliveries)
      .values({ ownerId: owner.id, key })
      .onConflictDoNothing();
    const [delivery] = await tx
      .select()
      .from(schema.notificationDeliveries)
      .where(and(eq(schema.notificationDeliveries.ownerId, owner.id), eq(schema.notificationDeliveries.key, key)))
      .for("update");
    if (!delivery || delivery.sentAt) return false;

    await sendOwnerMessage(text, replyMarkup);
    await tx
      .update(schema.notificationDeliveries)
      .set({ sentAt: new Date() })
      .where(eq(schema.notificationDeliveries.id, delivery.id));
    return true;
  });
}

export async function sendDuePaymentReminder(paymentId: string, name: string, amountMinor: number, currency: "PRB" | "USD", dueOn: string): Promise<boolean> {
  const keyboard = new InlineKeyboard().text("Оплата списана", `pay:${paymentId}`);
  const text = `Похоже, подошёл срок платежа: ${name} · ${formatMoney(amountMinor, currency)} · ${dueOn}. Проверь, списались ли деньги. Расход запишу только после твоего подтверждения.`;
  return sendDeduplicatedOwnerNotification(`payment:${paymentId}:${dueOn}`, text, keyboard);
}

export async function sendDailySummary(now: Date, timeZone: string): Promise<boolean> {
  const today = dateKey(now, timeZone);
  const snapshot = await loadSnapshot(today);
  const lines = [`Вот твоя сводка за сегодня · ${today}`];
  const nutrition = snapshot.nutrition;
  lines.push(`КБЖУ: ${Math.round(nutrition.consumed.calories)} / ${nutrition.target ? Math.round(nutrition.target.calories) : "—"} ккал`);
  lines.push(`Б ${Math.round(nutrition.consumed.proteinGrams)} · Ж ${Math.round(nutrition.consumed.fatGrams)} · У ${Math.round(nutrition.consumed.carbsGrams)} г`);
  if (nutrition.target) lines.push(`До цели по калориям осталось ${Math.max(0, Math.round(nutrition.target.calories - nutrition.consumed.calories))} ккал`);
  lines.push(`Расходы: ${formatMoney(snapshot.finance.spentTodayPrbMinor, "PRB")}`);
  const remaining = nutrition.target ? Math.max(0, Math.round(nutrition.target.calories - nutrition.consumed.calories)) : 0;
  if (remaining > 0) {
    const owner = await ensureOwner();
    const suggestions = await getUsualFoodSuggestions(owner.id, remaining);
    if (suggestions.length) {
      lines.push("Если захочешь добрать калории, вот знакомые варианты:");
      for (const suggestion of suggestions) {
        lines.push(`${formatPortionCount(suggestion.fraction)} «${suggestion.name}» (${suggestion.portionLabel}) ≈ ${Math.round(suggestion.macros.calories)} ккал · Б ${round1(suggestion.macros.proteinGrams)} · Ж ${round1(suggestion.macros.fatGrams)} · У ${round1(suggestion.macros.carbsGrams)} г`);
      }
    } else {
      lines.push("Пока не нашёл знакомых блюд для подсказки. Повторяющиеся блюда можно сохранить как обычную порцию.");
    }
  }
  return sendDeduplicatedOwnerNotification(`daily:${today}`, lines.join("\n"));
}

type FoodPortionCandidate = {
  name: string;
  portionLabel: string;
  macros: { calories: number; proteinGrams: number; fatGrams: number; carbsGrams: number };
  fraction: number;
};

async function getUsualFoodSuggestions(ownerId: string, remainingCalories: number): Promise<FoodPortionCandidate[]> {
  const [templates, entries] = await Promise.all([
    getDb().select({
      name: schema.foodTemplates.name,
      portionLabel: schema.foodTemplates.portionLabel,
      calories: schema.foodTemplates.calories,
      proteinGrams: schema.foodTemplates.proteinGrams,
      fatGrams: schema.foodTemplates.fatGrams,
      carbsGrams: schema.foodTemplates.carbsGrams,
    }).from(schema.foodTemplates).where(eq(schema.foodTemplates.ownerId, ownerId)),
    getDb().select({
      name: schema.nutritionEntries.name,
      portionLabel: schema.nutritionEntries.portionLabel,
      calories: schema.nutritionEntries.calories,
      proteinGrams: schema.nutritionEntries.proteinGrams,
      fatGrams: schema.nutritionEntries.fatGrams,
      carbsGrams: schema.nutritionEntries.carbsGrams,
      occurredAt: schema.nutritionEntries.occurredAt,
    }).from(schema.nutritionEntries).where(eq(schema.nutritionEntries.ownerId, ownerId)),
  ]);
  const candidates = new Map<string, Omit<FoodPortionCandidate, "fraction">>();
  for (const item of templates) {
    const macros = macroValues(item);
    if (macros.calories > 0) candidates.set(foodKey(item.name), { name: item.name, portionLabel: item.portionLabel, macros });
  }

  const repeated = new Map<string, { count: number; latest: typeof entries[number] }>();
  for (const entry of entries) {
    const key = foodKey(entry.name);
    if (candidates.has(key)) continue;
    const current = repeated.get(key);
    if (!current) repeated.set(key, { count: 1, latest: entry });
    else repeated.set(key, {
      count: current.count + 1,
      latest: entry.occurredAt > current.latest.occurredAt ? entry : current.latest,
    });
  }
  for (const [key, item] of repeated) {
    if (item.count < 2) continue;
    const macros = macroValues(item.latest);
    if (macros.calories > 0) candidates.set(key, { name: item.latest.name, portionLabel: item.latest.portionLabel, macros });
  }

  return [...candidates.values()]
    .map((candidate) => {
      const fraction = Math.max(0.25, Math.min(2, Math.floor((remainingCalories / candidate.macros.calories) * 4) / 4));
      return { ...candidate, fraction };
    })
    .sort((a, b) => Math.abs(a.macros.calories * a.fraction - remainingCalories) - Math.abs(b.macros.calories * b.fraction - remainingCalories))
    .slice(0, 2)
    .map((candidate) => ({
      ...candidate,
      macros: {
        calories: candidate.macros.calories * candidate.fraction,
        proteinGrams: candidate.macros.proteinGrams * candidate.fraction,
        fatGrams: candidate.macros.fatGrams * candidate.fraction,
        carbsGrams: candidate.macros.carbsGrams * candidate.fraction,
      },
    }));
}

function macroValues(values: { calories: string; proteinGrams: string; fatGrams: string; carbsGrams: string }) {
  return {
    calories: Number(values.calories),
    proteinGrams: Number(values.proteinGrams),
    fatGrams: Number(values.fatGrams),
    carbsGrams: Number(values.carbsGrams),
  };
}

function foodKey(name: string): string {
  return name.trim().toLocaleLowerCase("ru-RU");
}

function formatPortionCount(fraction: number): string {
  const formatted = fraction.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
  if (fraction === 1) return "1 порция";
  if (fraction === 2) return "2 порции";
  return `${formatted} порции`;
}

export async function sendWeeklySummary(now: Date, timeZone: string): Promise<boolean> {
  const localToday = dateKey(now, timeZone);
  const weekday = new Date(`${localToday}T12:00:00Z`).getUTCDay();
  const monday = new Date(`${localToday}T12:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - ((weekday + 6) % 7));
  const weekStart = monday.toISOString().slice(0, 10);
  const owner = await ensureOwner();
  const [foods, money, sessions, weights, sets] = await Promise.all([
    getDb().select().from(schema.nutritionEntries).where(eq(schema.nutritionEntries.ownerId, owner.id)),
    getDb().select().from(schema.financeEntries).where(eq(schema.financeEntries.ownerId, owner.id)),
    getDb().select().from(schema.workoutSessions).where(eq(schema.workoutSessions.ownerId, owner.id)),
    getDb().select().from(schema.weightEntries).where(eq(schema.weightEntries.ownerId, owner.id)),
    getDb().select().from(schema.workoutSets).where(eq(schema.workoutSets.ownerId, owner.id)),
  ]);
  const isThisWeek = (date: Date) => {
    const local = dateKey(date, timeZone);
    return local >= weekStart && local <= localToday;
  };
  const weeklyFoods = foods.filter((entry) => isThisWeek(entry.occurredAt));
  const macros = sumMacros(weeklyFoods.map((entry) => ({
    calories: Number(entry.calories),
    proteinGrams: Number(entry.proteinGrams),
    fatGrams: Number(entry.fatGrams),
    carbsGrams: Number(entry.carbsGrams),
  })));
  const loggedDays = new Set(weeklyFoods.map((entry) => dateKey(entry.occurredAt, timeZone)));
  const weeklySpending = money
    .filter((entry) => entry.entryType === "expense" && isThisWeek(entry.occurredAt))
    .reduce((sum, entry) => sum + convertToLocalMinor(
      Math.round(Number(entry.amount) * 100),
      entry.currency === "USD" ? "USD" : "PRB",
      entry.usdToPrbRate,
    ), 0);
  const completedWorkouts = sessions.filter((session) => session.status === "completed" && session.completedAt && isThisWeek(session.completedAt)).length;
  const completedSets = sets.filter((set) => set.isCompleted && set.completedAt && isThisWeek(set.completedAt)).length;
  const weeklyWeights = weights
    .filter((entry) => isThisWeek(entry.occurredAt))
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const weightLine = weeklyWeights.length < 2
    ? weeklyWeights.length === 1 ? `Вес: ${round1(Number(weeklyWeights[0].weightKg))} кг · одна запись за неделю` : "Вес: записей на этой неделе нет"
    : `Вес: ${round1(Number(weeklyWeights[0].weightKg))} → ${round1(Number(weeklyWeights[weeklyWeights.length - 1].weightKg))} кг (${formatSigned(Number(weeklyWeights[weeklyWeights.length - 1].weightKg) - Number(weeklyWeights[0].weightKg))} кг)`;
  const text = [
    `Вот как прошла неделя · ${weekStart} — ${localToday}`,
    `Питание: ${Math.round(macros.calories)} ккал · Б ${Math.round(macros.proteinGrams)} · Ж ${Math.round(macros.fatGrams)} · У ${Math.round(macros.carbsGrams)} г суммарно`,
    loggedDays.size ? `Среднее: ${Math.round(macros.calories / loggedDays.size)} ккал за ${loggedDays.size} дн. с записями` : "Питание: записей за неделю нет",
    `Расходы: ${formatMoney(weeklySpending, "PRB")}`,
    `Тренировки: ${completedWorkouts} · подходы: ${completedSets}`,
    weightLine,
  ].join("\n");
  return sendDeduplicatedOwnerNotification(`weekly:${localToday}`, text);
}

async function clearEditingCapture(id: string): Promise<void> {
  const owner = await ensureOwner();
  await getDb()
    .update(schema.ownerSettings)
    .set({ editingCaptureId: null, updatedAt: new Date() })
    .where(and(eq(schema.ownerSettings.id, owner.id), eq(schema.ownerSettings.editingCaptureId, id)));
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

async function markMessage(ctx: Context, text: string): Promise<void> {
  if (ctx.callbackQuery?.message) {
    await ctx.api.editMessageText(ctx.callbackQuery.message.chat.id, ctx.callbackQuery.message.message_id, text, {
      reply_markup: new InlineKeyboard(),
    }).catch(() => ctx.reply(text));
  } else {
    await ctx.reply(text);
  }
}
