import { and, desc, eq, lte } from "drizzle-orm";
import { InlineKeyboard } from "grammy";
import type { InlineKeyboardMarkup } from "grammy/types";
import type { MacroValues } from "@/domain/types";
import * as schema from "@/db/schema";
import { getDb } from "@/db/client";
import { debtReminderHeadline } from "@/domain/debts";
import { dateKey } from "@/domain/math";
import { isLastDayOfMonth, monthStart } from "@/domain/notifications";
import { MIN_WEEKLY_WEIGH_INS, targetFromAverage, weeklyAverageWeight } from "@/domain/nutrition";
import { normalizeModules, resolveFeatures } from "@/domain/modules";
import { buildReleaseNotice, releaseNoticeKey, type Release } from "@/domain/release";
import { ensureOwner, loadSnapshot, storedProfile } from "@/server/lifeos";
import { AppError } from "@/server/http";
import { currentTelegramUserId } from "@/server/owner-context";
import { getBot } from "@/server/telegram/client";
import { sendExportWithApi } from "@/server/telegram/export";
import { formatMoney, formatSigned, round1 } from "@/server/telegram/shared";
import { getAppUrl } from "@/server/telegram/shared";
import { loadPeriodReport } from "@/server/period-report";

export function summaryKeyboard(period: "day" | "week" | "month", start: string, existing?: InlineKeyboardMarkup): InlineKeyboardMarkup | undefined {
  const appUrl = getAppUrl();
  if (!appUrl) return existing;
  const url = new URL("/summary", appUrl);
  url.searchParams.set("period", period);
  url.searchParams.set("start", start);
  return new InlineKeyboard([...(existing?.inline_keyboard ?? []), [{ text: "Открыть сводку", web_app: { url: url.toString() } }]]);
}

export async function sendExportToChat(telegramUserId: string): Promise<void> {
  await sendExportWithApi(getBot().api, telegramUserId);
}

export async function sendOwnerMessage(
  text: string,
  replyMarkup?: InlineKeyboardMarkup,
): Promise<void> {
  const resolvedId = currentTelegramUserId();
  if (!resolvedId || !/^[1-9]\d{0,19}$/.test(resolvedId)) throw new AppError(503, "Telegram ID получателя не настроен.");
  const ownerId = Number(resolvedId);
  if (!Number.isSafeInteger(ownerId)) throw new AppError(503, "Telegram ID получателя не настроен.");
  await getBot().api.sendMessage(ownerId, text, replyMarkup ? { reply_markup: replyMarkup } : {});
}

/** Cheap pre-check so that a summary already sent is not built again on every cron call. */
export async function isOwnerNotificationSent(key: string): Promise<boolean> {
  const owner = await ensureOwner();
  const [delivery] = await getDb()
    .select({ sentAt: schema.notificationDeliveries.sentAt })
    .from(schema.notificationDeliveries)
    .where(and(eq(schema.notificationDeliveries.ownerId, owner.id), eq(schema.notificationDeliveries.key, key)))
    .limit(1);
  return Boolean(delivery?.sentAt);
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

/** One message per user and per version; the delivery key keeps it from being sent again. */
export async function sendReleaseNotice(release: Release): Promise<boolean> {
  const appUrl = process.env.APP_URL?.trim();
  const keyboard = appUrl && /^https:\/\//.test(appUrl) ? new InlineKeyboard().webApp("Открыть LifeOS", appUrl) : undefined;
  return sendDeduplicatedOwnerNotification(releaseNoticeKey(release.version), buildReleaseNotice(release), keyboard);
}

export async function sendDuePaymentReminder(paymentId: string, name: string, amountMinor: number, currency: string, dueOn: string): Promise<boolean> {
  const keyboard = new InlineKeyboard().text("Оплата списана", `pay:${paymentId}:${dueOn}`);
  const text = `Похоже, подошёл срок платежа: ${name} · ${formatMoney(amountMinor, currency)} · ${dueOn}. Проверь, списались ли деньги. Расход запишу только после твоего подтверждения.`;
  return sendDeduplicatedOwnerNotification(`payment:${paymentId}:${dueOn}`, text, keyboard);
}

export async function sendDueDebtReminder(
  debtId: string,
  personName: string,
  direction: "i_owe" | "owed_to_me",
  remainingAmountMinor: number,
  dueOn: string,
  localDate: string,
  baseCurrency: string,
): Promise<boolean> {
  const message = debtReminderHeadline(direction, personName, dueOn, localDate);
  if (!message) return false;
  const text = message + " · остаток " + formatMoney(remainingAmountMinor, baseCurrency) + " · срок " + dueOn + ".";
  return sendDeduplicatedOwnerNotification("debt:" + debtId + ":" + localDate, text);
}

export async function sendDailySummary(now: Date, timeZone: string): Promise<boolean> {
  const today = dateKey(now, timeZone);
  if (await isOwnerNotificationSent(`daily:${today}`)) return false;
  const snapshot = await loadSnapshot(today);
  const lines = [`Вот твоя сводка за сегодня · ${today}`];
  const modules = snapshot.settings.enabledModules;
  const nutritionOn = modules.includes("nutrition");
  if (!nutritionOn && !modules.includes("finance")) return false;
  const nutrition = snapshot.nutrition;
  if (nutritionOn) {
    lines.push(`КБЖУ: ${Math.round(nutrition.consumed.calories)} / ${nutrition.target ? Math.round(nutrition.target.calories) : "—"} ккал`);
    lines.push(`Б ${Math.round(nutrition.consumed.proteinGrams)} · Ж ${Math.round(nutrition.consumed.fatGrams)} · У ${Math.round(nutrition.consumed.carbsGrams)} г`);
    if (nutrition.target) lines.push(`До цели по калориям осталось ${Math.max(0, Math.round(nutrition.target.calories - nutrition.consumed.calories))} ккал`);
  }
  if (modules.includes("finance")) lines.push(`Расходы: ${formatMoney(snapshot.finance.spentTodayMinor, snapshot.settings.baseCurrency)}`);
  const remaining = nutritionOn && nutrition.target ? Math.max(0, Math.round(nutrition.target.calories - nutrition.consumed.calories)) : 0;
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
  return sendDeduplicatedOwnerNotification(`daily:${today}`, lines.join("\n"), summaryKeyboard("day", today));
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
  return sendPeriodSummary(now, timeZone, "week", monday.toISOString().slice(0, 10));
}

/** Month-to-date summary for the last calendar day of the owner's month; any other day sends nothing. */
export async function sendMonthlySummary(now: Date, timeZone: string): Promise<boolean> {
  const localToday = dateKey(now, timeZone);
  if (!isLastDayOfMonth(localToday)) return false;
  return sendPeriodSummary(now, timeZone, "month", monthStart(localToday));
}

async function sendPeriodSummary(now: Date, timeZone: string, period: "week" | "month", weekStart: string): Promise<boolean> {
  const localToday = dateKey(now, timeZone);
  const key = `${period === "week" ? "weekly" : "monthly"}:${localToday}`;
  if (await isOwnerNotificationSent(key)) return false;
  const owner = await ensureOwner();
  const [report, weights] = await Promise.all([
    loadPeriodReport(period, weekStart, now),
    getDb().select().from(schema.weightEntries).where(eq(schema.weightEntries.ownerId, owner.id)),
  ]);
  const nutrition = report.nutrition;
  const weight = report.weight;
  const weightLine = weight?.first === null
    ? `Вес: записей ${period === "week" ? "на этой неделе" : "в этом месяце"} нет`
    : weight?.points.length === 1
      ? `Вес: ${round1(weight.first!)} кг · одна запись ${period === "week" ? "за неделю" : "за месяц"}`
      : weight ? `Вес: ${round1(weight.first!)} → ${round1(weight.last!)} кг (${formatSigned(weight.change!)} кг)` : "";
  const modules = normalizeModules(owner.enabledModules);
  const nutritionOn = modules.includes("nutrition");
  const weightOn = resolveFeatures(modules, owner.disabledFeatures).includes("nutrition.weight");
  const text = [
    `${period === "week" ? "Вот как прошла неделя" : "Вот как прошёл месяц"} · ${weekStart} — ${localToday}`,
    ...(nutritionOn ? [
      `Питание: ${Math.round(nutrition!.total.calories)} ккал · Б ${Math.round(nutrition!.total.proteinGrams)} · Ж ${Math.round(nutrition!.total.fatGrams)} · У ${Math.round(nutrition!.total.carbsGrams)} г суммарно`,
      nutrition!.loggedDays ? `Среднее: ${Math.round(nutrition!.average.calories)} ккал за ${nutrition!.loggedDays} дн. с записями` : `Питание: записей за ${period === "week" ? "неделю" : "месяц"} нет`,
    ] : []),
    ...(modules.includes("finance") ? [`Расходы: ${formatMoney(report.finance!.expenseMinor, owner.baseCurrency ?? "")}`] : []),
    ...(modules.includes("gym") ? [`Тренировки: ${report.gym!.workouts} · подходы: ${report.gym!.sets}`] : []),
    ...(weightOn ? [weightLine] : []),
  ];
  const [currentTarget] = await getDb().select().from(schema.nutritionTargets)
    .where(and(eq(schema.nutritionTargets.ownerId, owner.id), lte(schema.nutritionTargets.effectiveFrom, localToday)))
    .orderBy(desc(schema.nutritionTargets.effectiveFrom))
    .limit(1);
  const recalculation = weeklyTargetRecalculation(
    storedProfile(owner, localToday),
    weights.map((entry) => ({ date: dateKey(entry.occurredAt, timeZone), weightKg: Number(entry.weightKg) })),
    localToday,
    currentTarget ? macroValues(currentTarget) : null,
  );
  if (period === "week" && weightOn && recalculation.line) text.push("", recalculation.line);
  return sendDeduplicatedOwnerNotification(key, text.join("\n"), summaryKeyboard(period, weekStart, period === "week" && weightOn ? recalculation.keyboard : undefined));
}

/** Midweek nudge when the 7-day window has too few weigh-ins for the Sunday target recalculation. */
export async function sendWeightReminder(now: Date, timeZone: string): Promise<boolean> {
  const localToday = dateKey(now, timeZone);
  if (await isOwnerNotificationSent(`weight-reminder:${localToday}`)) return false;
  const owner = await ensureOwner();
  const weights = await getDb().select().from(schema.weightEntries).where(eq(schema.weightEntries.ownerId, owner.id));
  const week = weeklyAverageWeight(weights.map((entry) => ({ date: dateKey(entry.occurredAt, timeZone), weightKg: Number(entry.weightKg) })), localToday);
  if (week.weighIns >= MIN_WEEKLY_WEIGH_INS) return false;
  const text = `Чтобы в воскресенье пересчитать норму КБЖУ по среднему весу, нужно хотя бы ${MIN_WEEKLY_WEIGH_INS} замера за 7 дней, сейчас ${week.weighIns}. Взвесься и напиши, например, «вес 72,4» — или запиши вес в LifeOS.`;
  return sendDeduplicatedOwnerNotification(`weight-reminder:${localToday}`, text);
}

/**
 * Daily «weigh in» nudge. Shares the delivery key with the Thursday reminder, so on a day when both are due the user gets one
 * message (whichever is sent first). Stays quiet once a weight is already logged today.
 */
export async function sendDailyWeightReminder(now: Date, timeZone: string): Promise<boolean> {
  const localToday = dateKey(now, timeZone);
  if (await isOwnerNotificationSent(`weight-reminder:${localToday}`)) return false;
  const owner = await ensureOwner();
  const weights = await getDb().select().from(schema.weightEntries).where(eq(schema.weightEntries.ownerId, owner.id));
  if (weights.some((entry) => dateKey(entry.occurredAt, timeZone) === localToday)) return false;
  return sendDeduplicatedOwnerNotification(`weight-reminder:${localToday}`, "Пора взвеситься. Напиши, например, «вес 72,4» — или запиши вес в LifeOS.");
}

/** Weekly target proposal: the profile formula with the 7-day average weight, applied only after a button press. */
function weeklyTargetRecalculation(
  profile: ReturnType<typeof storedProfile>,
  weights: { date: string; weightKg: number }[],
  today: string,
  current: MacroValues | null,
): { line: string | null; keyboard?: InlineKeyboardMarkup } {
  const week = weeklyAverageWeight(weights, today);
  if (week.averageKg === null) return { line: null };
  if (week.weighIns < MIN_WEEKLY_WEIGH_INS) {
    return { line: `Норму КБЖУ не пересчитываю: за 7 дней замеров веса: ${week.weighIns}, нужно хотя бы ${MIN_WEEKLY_WEIGH_INS}.` };
  }
  const average = `Средний вес за 7 дней: ${round1(week.averageKg)} кг.`;
  const next = targetFromAverage(profile, week.averageKg, current);
  if (!next) {
    const complete = Object.values(profile).every((value) => value !== undefined);
    return { line: complete ? `${average} Норма КБЖУ остаётся прежней.` : `${average} Заполни профиль в «Цели КБЖУ» в LifeOS — тогда буду предлагать новую норму по среднему весу.` };
  }
  const was = current ? ` (сейчас ${Math.round(current.calories)} ккал)` : "";
  return {
    line: `${average} По профилю норма теперь ${next.calories} ккал · Б ${next.proteinGrams} · Ж ${next.fatGrams} · У ${next.carbsGrams} г${was}. Применить?`,
    keyboard: new InlineKeyboard()
      .text("Применить", `tgt:${next.calories}-${next.proteinGrams}-${next.fatGrams}-${next.carbsGrams}`)
      .text("Оставить", "tgt:keep"),
  };
}
