import { and, desc, eq, lte } from "drizzle-orm";
import { InlineKeyboard } from "grammy";
import type { InlineKeyboardMarkup } from "grammy/types";
import type { MacroValues } from "@/domain/types";
import * as schema from "@/db/schema";
import { getDb } from "@/db/client";
import { debtReminderHeadline } from "@/domain/debts";
import { dateKey, sumMacros, convertToBaseMinor } from "@/domain/math";
import { MIN_WEEKLY_WEIGH_INS, targetFromAverage, weeklyAverageWeight } from "@/domain/nutrition";
import { normalizeModules, resolveFeatures } from "@/domain/modules";
import { ensureOwner, loadSnapshot, storedProfile } from "@/server/lifeos";
import { AppError } from "@/server/http";
import { currentTelegramUserId } from "@/server/owner-context";
import { getBot } from "@/server/telegram/client";
import { sendExportWithApi } from "@/server/telegram/export";
import { formatMoney, formatSigned, round1 } from "@/server/telegram/shared";

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
    .reduce((sum, entry) => sum + convertToBaseMinor(
      Math.round(Number(entry.amount) * 100),
      entry.currency,
      owner.baseCurrency ?? entry.currency,
      entry.rateToBase,
    ), 0);
  const completedWorkouts = sessions.filter((session) => session.status === "completed" && session.completedAt && isThisWeek(session.completedAt)).length;
  const completedSets = sets.filter((set) => set.isCompleted && set.completedAt && isThisWeek(set.completedAt)).length;
  const weeklyWeights = weights
    .filter((entry) => isThisWeek(entry.occurredAt))
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const weightLine = weeklyWeights.length < 2
    ? weeklyWeights.length === 1 ? `Вес: ${round1(Number(weeklyWeights[0].weightKg))} кг · одна запись за неделю` : "Вес: записей на этой неделе нет"
    : `Вес: ${round1(Number(weeklyWeights[0].weightKg))} → ${round1(Number(weeklyWeights[weeklyWeights.length - 1].weightKg))} кг (${formatSigned(Number(weeklyWeights[weeklyWeights.length - 1].weightKg) - Number(weeklyWeights[0].weightKg))} кг)`;
  const modules = normalizeModules(owner.enabledModules);
  const nutritionOn = modules.includes("nutrition");
  const weightOn = resolveFeatures(modules, owner.disabledFeatures).includes("nutrition.weight");
  const text = [
    `Вот как прошла неделя · ${weekStart} — ${localToday}`,
    ...(nutritionOn ? [
      `Питание: ${Math.round(macros.calories)} ккал · Б ${Math.round(macros.proteinGrams)} · Ж ${Math.round(macros.fatGrams)} · У ${Math.round(macros.carbsGrams)} г суммарно`,
      loggedDays.size ? `Среднее: ${Math.round(macros.calories / loggedDays.size)} ккал за ${loggedDays.size} дн. с записями` : "Питание: записей за неделю нет",
    ] : []),
    ...(modules.includes("finance") ? [`Расходы: ${formatMoney(weeklySpending, owner.baseCurrency ?? "")}`] : []),
    ...(modules.includes("gym") ? [`Тренировки: ${completedWorkouts} · подходы: ${completedSets}`] : []),
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
  if (weightOn && recalculation.line) text.push("", recalculation.line);
  return sendDeduplicatedOwnerNotification(`weekly:${localToday}`, text.join("\n"), weightOn ? recalculation.keyboard : undefined);
}

/** Midweek nudge when the 7-day window has too few weigh-ins for the Sunday target recalculation. */
export async function sendWeightReminder(now: Date, timeZone: string): Promise<boolean> {
  const localToday = dateKey(now, timeZone);
  const owner = await ensureOwner();
  const weights = await getDb().select().from(schema.weightEntries).where(eq(schema.weightEntries.ownerId, owner.id));
  const week = weeklyAverageWeight(weights.map((entry) => ({ date: dateKey(entry.occurredAt, timeZone), weightKg: Number(entry.weightKg) })), localToday);
  if (week.weighIns >= MIN_WEEKLY_WEIGH_INS) return false;
  const text = `Чтобы в воскресенье пересчитать норму КБЖУ по среднему весу, нужно хотя бы ${MIN_WEEKLY_WEIGH_INS} замера за 7 дней, сейчас ${week.weighIns}. Взвесься и напиши, например, «вес 72,4» — или запиши вес в LifeOS.`;
  return sendDeduplicatedOwnerNotification(`weight-reminder:${localToday}`, text);
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
