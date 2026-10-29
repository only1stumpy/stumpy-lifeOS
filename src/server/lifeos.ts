import { and, desc, eq, lte } from "drizzle-orm";
import { getDb, type Transaction } from "@/db/client";
import * as s from "@/db/schema";
import type { AppSnapshot } from "@/domain/app";
import type { AppCommand } from "@/domain/commands";
import type { MacroValues, FoodLogEntry, WorkoutDay } from "@/domain/types";
import { convertToLocalMinor, dateKey, sumMacros } from "@/domain/math";
import { advanceRecurrenceDate } from "@/domain/recurrence";
import { shouldSuggestLoadIncrease } from "@/domain/progression";
import { AppError } from "./http";
import { analyzeMessage } from "./ai/analyze";
import type { AnalyzeMessageInput } from "./ai/types";
import { activeClarificationHistory, nextClarificationHistory } from "./ai/clarification";
import { resolveTelegramUserId } from "./owner-context";
import { loadConfiguredAiProviderConfigs } from "./ai/provider-accounts";

const decimal = (minor: number) => {
  const n = BigInt(minor);
  return (n < 0n ? "-" : "") + String((n < 0n ? -n : n) / 100n) + "." + String((n < 0n ? -n : n) % 100n).padStart(2, "0");
};
const toMinor = (value: string) => {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace("-", "").split(".");
  const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
  return Number(negative ? -amount : amount);
};
const macroNumbers = (row: { calories: string; proteinGrams: string; fatGrams: string; carbsGrams: string }): MacroValues => ({
  calories: Number(row.calories), proteinGrams: Number(row.proteinGrams), fatGrams: Number(row.fatGrams), carbsGrams: Number(row.carbsGrams),
});
const macroStrings = (row: MacroValues) => ({
  calories: String(row.calories), proteinGrams: String(row.proteinGrams), fatGrams: String(row.fatGrams), carbsGrams: String(row.carbsGrams),
});
const asCurrency = (v: string): "PRB" | "USD" => v === "USD" ? "USD" : "PRB";

export function buildNutritionHistoryDays(
  rows: { occurredAt: Date | string; macros: MacroValues }[],
  timeZone: string,
  localDate: string,
): AppSnapshot["reports"]["nutritionDays"] {
  const byDate = new Map<string, { entryCount: number; macros: MacroValues }>();
  for (const row of rows) {
    const date = dateKey(row.occurredAt, timeZone);
    const current = byDate.get(date) ?? { entryCount: 0, macros: { calories: 0, proteinGrams: 0, fatGrams: 0, carbsGrams: 0 } };
    byDate.set(date, { entryCount: current.entryCount + 1, macros: sumMacros([current.macros, row.macros]) });
  }
  if (!byDate.has(localDate)) {
    byDate.set(localDate, { entryCount: 0, macros: { calories: 0, proteinGrams: 0, fatGrams: 0, carbsGrams: 0 } });
  }
  return [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, value]) => ({ date, entryCount: value.entryCount, ...value.macros }));
}

export async function ensureOwner(explicitTelegramUserId?: string) {
  const telegramUserId = resolveTelegramUserId(explicitTelegramUserId);
  if (!telegramUserId || !/^[1-9]\d{0,19}$/.test(telegramUserId)) throw new AppError(503, "Профиль Telegram не найден.");
  const db = getDb();
  await db.insert(s.ownerSettings).values({ telegramUserId }).onConflictDoNothing();
  const [owner] = await db.select().from(s.ownerSettings).where(eq(s.ownerSettings.telegramUserId, telegramUserId));
  if (!owner) throw new AppError(503, "Не удалось загрузить профиль.");
  return owner;
}

export async function loadSnapshot(selectedDate?: string): Promise<AppSnapshot> {
  const owner = await ensureOwner();
  const db = getDb();
  const ownerId = owner.id;
  const today = dateKey(new Date(), owner.timezone);
  if (selectedDate && (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate) || !Number.isFinite(Date.parse(selectedDate + "T12:00:00Z")) || new Date(selectedDate + "T12:00:00Z").toISOString().slice(0, 10) !== selectedDate)) throw new AppError(400, "Некорректная дата дневника.");
  const localDate = selectedDate && /^\d{4}-\d{2}-\d{2}$/.test(selectedDate) ? selectedDate : today;
  // ponytail: a personal journal is read as a whole; add paginated history when its size warrants it.
  const [foods, targets, weights, accounts, categories, money, rates, recurring, plans, days, dayItems, exercises, sessions, sessionItems, sets, captures, foodDrafts, moneyDrafts, templates] = await Promise.all([
    db.select().from(s.nutritionEntries).where(eq(s.nutritionEntries.ownerId, ownerId)).orderBy(desc(s.nutritionEntries.occurredAt)),
    db.select().from(s.nutritionTargets).where(and(eq(s.nutritionTargets.ownerId, ownerId), lte(s.nutritionTargets.effectiveFrom, localDate))).orderBy(desc(s.nutritionTargets.effectiveFrom)),
    db.select().from(s.weightEntries).where(eq(s.weightEntries.ownerId, ownerId)).orderBy(s.weightEntries.occurredAt),
    db.select().from(s.financeAccounts).where(and(eq(s.financeAccounts.ownerId, ownerId), eq(s.financeAccounts.isArchived, false))),
    db.select().from(s.financeCategories).where(eq(s.financeCategories.ownerId, ownerId)),
    db.select().from(s.financeEntries).where(eq(s.financeEntries.ownerId, ownerId)).orderBy(desc(s.financeEntries.occurredAt)),
    db.select().from(s.exchangeRates).where(eq(s.exchangeRates.ownerId, ownerId)).orderBy(desc(s.exchangeRates.effectiveAt)),
    db.select().from(s.recurringPayments).where(and(eq(s.recurringPayments.ownerId, ownerId), eq(s.recurringPayments.isActive, true))),
    db.select().from(s.financePlans).where(eq(s.financePlans.ownerId, ownerId)).orderBy(s.financePlans.createdAt),
    db.select().from(s.workoutDays).where(and(eq(s.workoutDays.ownerId, ownerId), eq(s.workoutDays.isArchived, false))).orderBy(s.workoutDays.position),
    db.select().from(s.workoutDayExercises).where(eq(s.workoutDayExercises.ownerId, ownerId)).orderBy(s.workoutDayExercises.position),
    db.select().from(s.exercises).where(eq(s.exercises.ownerId, ownerId)),
    db.select().from(s.workoutSessions).where(eq(s.workoutSessions.ownerId, ownerId)).orderBy(desc(s.workoutSessions.startedAt)),
    db.select().from(s.workoutSessionExercises).where(eq(s.workoutSessionExercises.ownerId, ownerId)),
    db.select().from(s.workoutSets).where(eq(s.workoutSets.ownerId, ownerId)),
    db.select().from(s.captureDrafts).where(and(eq(s.captureDrafts.ownerId, ownerId), eq(s.captureDrafts.status, "pending"))).orderBy(s.captureDrafts.createdAt),
    db.select().from(s.nutritionDrafts).where(eq(s.nutritionDrafts.ownerId, ownerId)),
    db.select().from(s.moneyDrafts).where(eq(s.moneyDrafts.ownerId, ownerId)),
    db.select().from(s.foodTemplates).where(eq(s.foodTemplates.ownerId, ownerId)),
  ]);
  const active = sessions.find((v) => v.status === "active");
  const last = sessions.find((v) => v.status === "completed");
  const program: WorkoutDay[] = days.map((day) => ({
    id: day.id, name: day.name,
    exercises: dayItems.filter((i) => i.workoutDayId === day.id).map((item) => {
      const exercise = exercises.find((e) => e.id === item.exerciseId)!;
      const activeItem = sessionItems.find((i) => i.sessionId === active?.id && i.workoutDayExerciseId === item.id);
      const previousItem = sessionItems.filter((i) => i.exerciseId === item.exerciseId && sessions.some((session) => session.id === i.sessionId && session.status === "completed"))
        .sort((a, b) => (sessions.findIndex((x) => x.id === a.sessionId)) - (sessions.findIndex((x) => x.id === b.sessionId)))[0];
      const previousSets = sets.filter((v) => v.sessionExerciseId === previousItem?.id && v.isCompleted).sort((a,b) => a.setNumber-b.setNumber);
      const progressionHint = item.targetRepsMax !== null && shouldSuggestLoadIncrease(previousSets, item.plannedSets, item.targetRepsMax)
        ? "В прошлый раз все подходы достигли верхней границы повторений — можно попробовать немного увеличить вес."
        : null;
      return {
        id: item.id, name: activeItem?.exerciseName ?? exercise?.name ?? "Упражнение", restSeconds: item.restSeconds ?? 90,
        previousPerformance: previousSets.length ? previousSets.map((v) => v.weightKg !== null ? Number(v.weightKg) + " кг × " + (v.repetitions ?? "—") : (v.durationSeconds ?? 0) + " с").join(", ") : null,
        progressionHint,
        sets: Array.from({ length: item.plannedSets }, (_, i) => {
          const current = sets.find((v) => v.sessionExerciseId === activeItem?.id && v.setNumber === i + 1);
          const previous = previousSets.find((v) => v.setNumber === i + 1);
          return {
            id: current?.id ?? item.id + ":" + (i + 1), index: i + 1,
            weightKg: current?.weightKg != null ? Number(current.weightKg) : previous?.weightKg != null ? Number(previous.weightKg) : null,
            repetitions: current?.repetitions ?? previous?.repetitions ?? item.targetRepsMin,
            durationSeconds: current?.durationSeconds ?? null, distanceMeters: current?.distanceMeters != null ? Number(current.distanceMeters) : null,
            completed: current?.isCompleted ?? false,
          };
        }),
      };
    }),
  }));
  const foodEntries: FoodLogEntry[] = foods.filter((v) => dateKey(v.occurredAt, owner.timezone) === localDate).map((v) => ({
    id: v.id, label: v.name, occurredAt: v.occurredAt.toISOString(), portionLabel: v.portionLabel, estimated: v.estimated, ...macroNumbers(v),
  }));
  const expenses = money.filter((v) => v.entryType === "expense");
  const totalExpenses = (rows: typeof expenses) => rows.reduce((sum, v) => sum + convertToLocalMinor(toMinor(v.amount), asCurrency(v.currency), v.usdToPrbRate), 0);
  const calendar = Array.from({ length: 31 }, (_, i) => {
    const date = new Date(localDate + "T12:00:00Z");
    date.setUTCDate(date.getUTCDate() - 30 + i);
    return date.toISOString().slice(0, 10);
  });
  const monthlyExpenses = expenses.filter((v) => { const date = dateKey(v.occurredAt, owner.timezone); return date.slice(0, 7) === localDate.slice(0, 7) && date <= localDate; });
  const [year, month, day] = localDate.split("-").map(Number);
  const previousEnd = new Date(Date.UTC(year, month - 1, 0));
  previousEnd.setUTCDate(Math.min(day, previousEnd.getUTCDate()));
  const previousPeriodEnd = previousEnd.toISOString().slice(0, 10);
  const previousExpenses = expenses.filter((v) => { const key = dateKey(v.occurredAt, owner.timezone); return key.slice(0, 7) === previousPeriodEnd.slice(0, 7) && key <= previousPeriodEnd; });
  const repeated = [...new Set(monthlyExpenses.map((v) => v.name.trim().toLocaleLowerCase("ru")))].map((name) => {
    const rows = monthlyExpenses.filter((v) => v.name.trim().toLocaleLowerCase("ru") === name);
    return { name: rows[0].name, count: rows.length, amountMinor: totalExpenses(rows) };
  }).filter((v) => v.count > 1).sort((a, b) => b.amountMinor - a.amountMinor);
  const reports: AppSnapshot["reports"] = {
    nutritionDays: buildNutritionHistoryDays(foods.map((food) => ({ occurredAt: food.occurredAt, macros: macroNumbers(food) })), owner.timezone, localDate),
    expenseDays: calendar.map((date) => ({ date, amountMinor: totalExpenses(expenses.filter((v) => dateKey(v.occurredAt, owner.timezone) === date)) })),
    expenseCategories: categories.map((category) => ({ name: category.name, amountMinor: totalExpenses(monthlyExpenses.filter((v) => v.categoryId === category.id)) })).filter((v) => v.amountMinor > 0).sort((a, b) => b.amountMinor - a.amountMinor),
    monthComparison: { currentMinor: totalExpenses(monthlyExpenses.filter((v) => dateKey(v.occurredAt, owner.timezone) <= localDate)), previousMinor: totalExpenses(previousExpenses), previousPeriodEnd },
    repeatPurchases: repeated,
    largestPurchases: monthlyExpenses.map((v) => ({ name: v.name, amountMinor: totalExpenses([v]), occurredAt: v.occurredAt.toISOString() })).sort((a, b) => b.amountMinor - a.amountMinor).slice(0, 5),
    workoutHistory: sessions.filter((v) => v.status === "completed").map((session) => {
      const rows = sets.filter((set) => set.isCompleted && sessionItems.some((item) => item.sessionId === session.id && item.id === set.sessionExerciseId));
      return { id: session.id, name: session.name, completedAt: session.completedAt!.toISOString(), completedSets: rows.length, volumeKg: rows.reduce((sum, set) => sum + Number(set.weightKg ?? 0) * (set.repetitions ?? 0), 0) };
    }),
    exerciseProgress: exercises.map((exercise) => ({ id: exercise.id, name: exercise.name, points: sessions.filter((v) => v.status === "completed").reverse().flatMap((session) => {
      const rows = sets.filter((set) => set.isCompleted && set.weightKg !== null && sessionItems.some((item) => item.sessionId === session.id && item.exerciseId === exercise.id && item.id === set.sessionExerciseId));
      if (!rows.length) return [];
      const best = rows.reduce((a, b) => Number(a.weightKg) >= Number(b.weightKg) ? a : b);
      return [{ date: dateKey(session.completedAt!, owner.timezone), weightKg: Number(best.weightKg), repetitions: best.repetitions }];
    }) })).filter((v) => v.points.length > 0),
  };
  const localWeekday = new Date(localDate + "T12:00:00Z").getUTCDay();
  const planned = days.find((v) => v.weekday === localWeekday);
  return {
    localDate,
    reports,
    nutrition: { consumed: sumMacros(foodEntries), target: targets[0] ? macroNumbers(targets[0]) : null, entries: foodEntries, bodyWeightKg: weights.length ? Number(weights[weights.length - 1].weightKg) : null, weightHistory: weights.map((v) => ({ date: dateKey(v.occurredAt, owner.timezone), weightKg: Number(v.weightKg) })) },
    finance: {
      spentTodayPrbMinor: totalExpenses(expenses.filter((v) => dateKey(v.occurredAt, owner.timezone) === localDate)),
      spentMonthPrbMinor: totalExpenses(monthlyExpenses),
      accounts: accounts.map((v) => ({ id: v.id, name: v.name, currency: asCurrency(v.currency), openingBalanceMinor: toMinor(v.openingBalance), isDefault: v.isDefault, balanceMinor: toMinor(v.openingBalance) + money.filter((e) => e.accountId === v.id).reduce((sum, e) => sum + (e.entryType === "income" ? 1 : -1) * toMinor(e.amount), 0) })),
      entries: money.map((v) => ({ id: v.id, accountId: v.accountId, label: v.name, occurredAt: v.occurredAt.toISOString(), amountMinor: toMinor(v.amount), currency: asCurrency(v.currency), category: categories.find((c) => c.id === v.categoryId)?.name ?? "Без категории", kind: v.entryType as "expense" | "income" })),
      plans: plans.map((v) => ({ id: v.id, name: v.name, amountMinor: toMinor(v.amount) })),
    },
    gym: {
      trainingDay: Boolean(active || planned), nextWorkout: program.find((v) => v.id === (active?.workoutDayId ?? planned?.id)) ?? null,
      lastWorkout: last ? { name: last.name, completedAt: last.completedAt!.toISOString(), summary: sets.filter((v) => v.isCompleted && sessionItems.some((i) => i.sessionId === last.id && i.id === v.sessionExerciseId)).length + " подходов" } : null,
      program,
    },
    settings: { timeZone: owner.timezone, usdToPrb: rates[0]?.usdToPrbRate ?? null, defaultAccountId: accounts.find((v) => v.isDefault)?.id ?? accounts[0]?.id ?? null },
    recurring: recurring.map((v) => ({ id: v.id, name: v.name, amountMinor: toMinor(v.amount), accountId: v.accountId, currency: asCurrency(v.currency), category: categories.find((c) => c.id === v.categoryId)?.name ?? "", frequency: ({ week: "weekly", month: "monthly", year: "yearly" } as const)[v.intervalUnit as "week" | "month" | "year"] ?? "monthly", nextDueAt: v.nextDueOn + "T12:00:00Z" })),
    drafts: captures.map((v) => {
      const food = foodDrafts.find((f) => f.captureDraftId === v.id);
      const entry = moneyDrafts.find((m) => m.captureDraftId === v.id);
      return { id: v.id, description: v.messageText ?? "", occurredAt: (food?.occurredAt ?? entry?.occurredAt ?? v.createdAt).toISOString(),
        food: food ? { label: food.name, portionLabel: food.portionLabel, ...macroNumbers(food), estimated: food.estimated } : null,
        money: entry ? { label: entry.name, amountMinor: toMinor(entry.amount), currency: asCurrency(entry.currency), kind: entry.entryType as "expense" | "income", category: categories.find((c) => c.id === entry.categoryId)?.name ?? entry.proposedCategory } : null };
    }),
    templates: templates.map((v) => ({ id: v.id, name: v.name })),
    activeSession: active?.workoutDayId ? { id: active.id, dayId: active.workoutDayId, startedAt: active.startedAt.toISOString() } : null,
  };
}

async function category(tx: Transaction, ownerId: string, name: string, entryType: "income" | "expense") {
  await tx.insert(s.financeCategories).values({ ownerId, name, entryType }).onConflictDoNothing();
  const [row] = await tx.select().from(s.financeCategories).where(and(eq(s.financeCategories.ownerId, ownerId), eq(s.financeCategories.name, name), eq(s.financeCategories.entryType, entryType)));
  return row;
}

export async function setPendingMoneyDraftCategory(
  tx: Transaction,
  ownerId: string,
  draftId: string,
  name: string,
): Promise<void> {
  const [draft] = await tx.select().from(s.captureDrafts)
    .where(and(eq(s.captureDrafts.id, draftId), eq(s.captureDrafts.ownerId, ownerId)))
    .for("update");
  if (!draft) throw new AppError(404, "Черновик не найден.");
  if (draft.status !== "pending") throw new AppError(409, "Черновик уже отменён.");

  const [money] = await tx.select().from(s.moneyDrafts)
    .where(and(eq(s.moneyDrafts.captureDraftId, draftId), eq(s.moneyDrafts.ownerId, ownerId)));
  if (!money) throw new AppError(400, "Черновик не содержит финансовую операцию.");

  const group = await category(tx, ownerId, name, money.entryType as "expense" | "income");
  await tx.update(s.moneyDrafts)
    .set({ categoryId: group.id, proposedCategory: group.name })
    .where(and(eq(s.moneyDrafts.captureDraftId, draftId), eq(s.moneyDrafts.ownerId, ownerId)));
}

export function missingMoneyCategoryMessage(entryType: "expense" | "income"): string {
  const categoryKind = entryType === "income" ? "дохода" : "расхода";
  return `Уточните категорию ${categoryKind} через «Исправить».`;
}
async function account(tx: Transaction, ownerId: string, accountId?: string, currency?: string) {
  const rows = await tx.select().from(s.financeAccounts).where(and(eq(s.financeAccounts.ownerId, ownerId), eq(s.financeAccounts.isArchived, false)));
  const row = accountId ? rows.find((v) => v.id === accountId) : rows.find((v) => v.isDefault && (!currency || v.currency === currency)) ?? rows.find((v) => !currency || v.currency === currency);
  if (!row) throw new AppError(400, "Сначала добавьте счёт в нужной валюте.");
  return row;
}
async function rateAt(tx: Transaction, ownerId: string, currency: string, at: Date) {
  if (currency === "PRB") return null;
  const [rate] = await tx.select().from(s.exchangeRates).where(and(eq(s.exchangeRates.ownerId, ownerId), lte(s.exchangeRates.effectiveAt, at))).orderBy(desc(s.exchangeRates.effectiveAt)).limit(1);
  if (!rate) throw new AppError(400, "Для этой USD-операции нужен ручной курс. Сначала задайте курс.");
  return rate.usdToPrbRate;
}
async function startSession(tx: Transaction, ownerId: string, dayId: string) {
  const [day] = await tx.select().from(s.workoutDays).where(and(eq(s.workoutDays.id, dayId), eq(s.workoutDays.ownerId, ownerId)));
  if (!day) throw new AppError(404, "Тренировочный день не найден.");
  const [active] = await tx.select().from(s.workoutSessions).where(and(eq(s.workoutSessions.ownerId, ownerId), eq(s.workoutSessions.status, "active")));
  if (active) {
    if (active.workoutDayId !== dayId) throw new AppError(409, "Сначала завершите текущую тренировку.");
    return active;
  }
  const [session] = await tx.insert(s.workoutSessions).values({ ownerId, workoutDayId: dayId, name: day.name }).returning();
  const items = await tx.select().from(s.workoutDayExercises).where(eq(s.workoutDayExercises.workoutDayId, dayId));
  for (const item of items) {
    const [exercise] = await tx.select().from(s.exercises).where(eq(s.exercises.id, item.exerciseId));
    await tx.insert(s.workoutSessionExercises).values({ ownerId, sessionId: session.id, workoutDayExerciseId: item.id, exerciseId: item.exerciseId, exerciseName: exercise.name, position: item.position });
  }
  return session;
}

export async function analyzeCapture(input: Pick<AnalyzeMessageInput, "text" | "image"> & { previousDraftId?: string; telegramUpdateRowId?: string }) {
  const owner = await ensureOwner();
  if (input.telegramUpdateRowId) {
    const stored = await getDb().select().from(s.captureDrafts).where(and(eq(s.captureDrafts.ownerId, owner.id), eq(s.captureDrafts.telegramUpdateRowId, input.telegramUpdateRowId)));
    if (stored.length) return { entries: [], clarification: null, provider: null, model: null, draftIds: stored.map((v) => v.id) };
  }
  const snapshot = await loadSnapshot();
  const templates = await getDb().select().from(s.foodTemplates).where(eq(s.foodTemplates.ownerId, owner.id));
  const analyzedAt = new Date();
  const clarificationHistory = activeClarificationHistory(
    owner.aiClarificationHistory,
    owner.aiClarificationUpdatedAt,
    analyzedAt,
  );
  if (!clarificationHistory && (owner.aiClarificationHistory || owner.aiClarificationUpdatedAt)) {
    await getDb().update(s.ownerSettings)
      .set({ aiClarificationHistory: null, aiClarificationUpdatedAt: null, updatedAt: analyzedAt })
      .where(eq(s.ownerSettings.id, owner.id));
  }
  const providerProfiles = await loadConfiguredAiProviderConfigs(owner.id);
  const analysis = await analyzeMessage({ ...input, now: analyzedAt.toISOString(), timeZone: owner.timezone, clarificationHistory: clarificationHistory ?? undefined, templates: templates.map((v) => ({ name: v.name, portionLabel: v.portionLabel, ...macroNumbers(v) })), categories: [...new Set(snapshot.finance.entries.map((v) => v.category))], previousDraft: snapshot.drafts.find((v) => v.id === input.previousDraftId) }, {
    profiles: providerProfiles,
    ownerId: owner.id,
    allowLegacyProviders: Boolean(owner.telegramUserId && owner.telegramUserId === process.env.TELEGRAM_OWNER_ID?.trim()),
  });
  if (!analysis.entries.length) {
    const nextHistory = nextClarificationHistory(clarificationHistory, input.text, analysis.clarification, false);
    await getDb().update(s.ownerSettings)
      .set({ aiClarificationHistory: nextHistory, aiClarificationUpdatedAt: nextHistory ? analyzedAt : null, updatedAt: analyzedAt })
      .where(eq(s.ownerSettings.id, owner.id));
    return { ...analysis, draftIds: [] as string[] };
  }
  const draftIds: string[] = [];
  await getDb().transaction(async (tx) => {
    if (input.previousDraftId) await tx.update(s.captureDrafts).set({ status: "cancelled" }).where(and(eq(s.captureDrafts.ownerId, owner.id), eq(s.captureDrafts.id, input.previousDraftId), eq(s.captureDrafts.status, "pending")));
    for (const entry of analysis.entries) {
      const [capture] = await tx.insert(s.captureDrafts).values({ ownerId: owner.id, telegramUpdateRowId: input.telegramUpdateRowId, kind: entry.food && entry.money ? "combined" : entry.food ? "nutrition" : "finance", messageText: input.text }).returning();
      draftIds.push(capture.id);
      const occurredAt = new Date(entry.occurredAt);
      if (entry.food) await tx.insert(s.nutritionDrafts).values({ ownerId: owner.id, captureDraftId: capture.id, name: entry.food.label, portionLabel: entry.food.portionLabel, ...macroStrings(entry.food), estimated: entry.food.estimated, occurredAt });
      if (entry.money) {
        const allAccounts = snapshot.finance.accounts;
        const chosen = allAccounts.find((v) => v.id === snapshot.settings.defaultAccountId && v.currency === entry.money!.currency) ?? allAccounts.find((v) => v.currency === entry.money!.currency);
        await tx.insert(s.moneyDrafts).values({ ownerId: owner.id, captureDraftId: capture.id, name: entry.money.label, entryType: entry.money.kind, amount: decimal(entry.money.amountMinor), currency: entry.money.currency, accountId: chosen?.id ?? null, proposedCategory: entry.money.category, occurredAt });
      }
    }
    const resolvedHistory = nextClarificationHistory(clarificationHistory, input.text, analysis.clarification, draftIds.length > 0);
    await tx.update(s.ownerSettings)
      .set({ aiClarificationHistory: resolvedHistory, aiClarificationUpdatedAt: resolvedHistory ? analyzedAt : null, updatedAt: analyzedAt })
      .where(eq(s.ownerSettings.id, owner.id));
  });
  return { ...analysis, draftIds };
}

export async function executeCommand(command: AppCommand) {
  if (command.type === "analyze") { await analyzeCapture(command); return; }
  const owner = await ensureOwner();
  await getDb().transaction(async (tx) => {
    await tx.select().from(s.ownerSettings).where(eq(s.ownerSettings.id, owner.id)).for("update");
    switch (command.type) {
      case "settings.save": {
        try { new Intl.DateTimeFormat("ru", { timeZone: command.timeZone }).format(); } catch { throw new AppError(400, "Неизвестный часовой пояс."); }
        await tx.update(s.ownerSettings).set({ timezone: command.timeZone, updatedAt: new Date() }).where(eq(s.ownerSettings.id, owner.id));
        const effectiveFrom = dateKey(new Date(), command.timeZone);
        if (command.target) await tx.insert(s.nutritionTargets).values({ ownerId: owner.id, effectiveFrom, ...macroStrings(command.target) }).onConflictDoUpdate({ target: [s.nutritionTargets.ownerId, s.nutritionTargets.effectiveFrom], set: macroStrings(command.target) });
        break;
      }
      case "food.save": {
        const values = { ownerId: owner.id, name: command.label, portionLabel: command.portionLabel, occurredAt: new Date(command.occurredAt), estimated: command.estimated, ...macroStrings(command), source: "mini_app" };
        if (command.id) await tx.update(s.nutritionEntries).set({ ...values, updatedAt: new Date() }).where(and(eq(s.nutritionEntries.id, command.id), eq(s.nutritionEntries.ownerId, owner.id)));
        else await tx.insert(s.nutritionEntries).values(values);
        break;
      }
      case "food.delete": await tx.delete(s.nutritionEntries).where(and(eq(s.nutritionEntries.id, command.id), eq(s.nutritionEntries.ownerId, owner.id))); break;
      case "weight.save": await tx.insert(s.weightEntries).values({ ownerId: owner.id, weightKg: String(command.weightKg), occurredAt: new Date(command.date + "T12:00:00Z") }); break;
      case "account.save": {
        if (command.isDefault) await tx.update(s.financeAccounts).set({ isDefault: false }).where(eq(s.financeAccounts.ownerId, owner.id));
        if (command.id) {
          const [existing] = await tx.select().from(s.financeAccounts).where(and(eq(s.financeAccounts.id, command.id), eq(s.financeAccounts.ownerId, owner.id)));
          if (!existing || existing.currency !== command.currency) throw new AppError(400, "Валюту существующего счёта менять нельзя.");
          await tx.update(s.financeAccounts).set({ name: command.name, isDefault: command.isDefault, openingBalance: decimal(command.openingBalanceMinor) }).where(eq(s.financeAccounts.id, existing.id));
        } else await tx.insert(s.financeAccounts).values({ ownerId: owner.id, name: command.name, currency: command.currency, isDefault: command.isDefault, openingBalance: decimal(command.openingBalanceMinor) });
        break;
      }
      case "rate.save": await tx.insert(s.exchangeRates).values({ ownerId: owner.id, usdToPrbRate: command.usdToPrb, effectiveAt: command.effectiveAt ? new Date(command.effectiveAt) : new Date() }); break;
      case "money.save": {
        const chosen = await account(tx, owner.id, command.accountId);
        const group = await category(tx, owner.id, command.category, command.kind);
        const at = new Date(command.occurredAt);
        const [old] = command.id ? await tx.select().from(s.financeEntries).where(and(eq(s.financeEntries.id, command.id), eq(s.financeEntries.ownerId, owner.id))) : [];
        const sameMinute = old && Math.floor(old.occurredAt.getTime() / 60_000) === Math.floor(at.getTime() / 60_000);
        const rate = old && old.currency === chosen.currency && sameMinute ? old.usdToPrbRate : await rateAt(tx, owner.id, chosen.currency, at);
        const values = { ownerId: owner.id, accountId: chosen.id, categoryId: group.id, name: command.label, entryType: command.kind, amount: decimal(command.amountMinor), currency: chosen.currency, usdToPrbRate: rate, occurredAt: at, source: "mini_app" };
        if (command.id) {
          if (!old) throw new AppError(404, "Операция не найдена.");
          await tx.update(s.financeEntries).set({ ...values, updatedAt: new Date() }).where(eq(s.financeEntries.id, old.id));
        } else await tx.insert(s.financeEntries).values(values);
        break;
      }
      case "money.delete": await tx.delete(s.financeEntries).where(and(eq(s.financeEntries.id, command.id), eq(s.financeEntries.ownerId, owner.id))); break;
      case "finance-plan.save": {
        const values = { ownerId: owner.id, name: command.name, amount: decimal(command.amountMinor) };
        if (command.id) {
          const [existing] = await tx.select().from(s.financePlans)
            .where(and(eq(s.financePlans.id, command.id), eq(s.financePlans.ownerId, owner.id)));
          if (!existing) throw new AppError(404, "План покупки не найден.");
          await tx.update(s.financePlans).set({ ...values, updatedAt: new Date() })
            .where(and(eq(s.financePlans.id, existing.id), eq(s.financePlans.ownerId, owner.id)));
        } else {
          await tx.insert(s.financePlans).values(values);
        }
        break;
      }
      case "finance-plan.delete": {
        const [existing] = await tx.select().from(s.financePlans)
          .where(and(eq(s.financePlans.id, command.id), eq(s.financePlans.ownerId, owner.id)));
        if (!existing) throw new AppError(404, "План покупки не найден.");
        await tx.delete(s.financePlans)
          .where(and(eq(s.financePlans.id, command.id), eq(s.financePlans.ownerId, owner.id)));
        break;
      }
      case "finance-plan.purchase": {
        const [plan] = await tx.select().from(s.financePlans)
          .where(and(eq(s.financePlans.id, command.id), eq(s.financePlans.ownerId, owner.id)))
          .for("update");
        if (!plan) throw new AppError(404, "План покупки не найден.");

        const chosen = await account(tx, owner.id, command.accountId);
        if (chosen.currency !== "PRB") throw new AppError(400, "План покупки можно записать только со счёта в рублях ПМР.");
        const group = await category(tx, owner.id, command.category, "expense");
        await tx.insert(s.financeEntries).values({
          ownerId: owner.id,
          accountId: chosen.id,
          categoryId: group.id,
          name: command.label,
          entryType: "expense",
          amount: decimal(command.actualAmountMinor),
          currency: "PRB",
          usdToPrbRate: null,
          occurredAt: new Date(command.occurredAt),
          source: "mini_app",
        });
        await tx.delete(s.financePlans)
          .where(and(eq(s.financePlans.id, plan.id), eq(s.financePlans.ownerId, owner.id)));
        break;
      }
      case "recurring.save": {
        const chosen = await account(tx, owner.id, command.accountId);
        const group = await category(tx, owner.id, command.category, "expense");
        const nextDueOn = dateKey(command.nextDueAt, owner.timezone);
        const [, month, day] = nextDueOn.split("-").map(Number);
        const values = { ownerId: owner.id, accountId: chosen.id, categoryId: group.id, name: command.name, amount: decimal(command.amountMinor), currency: chosen.currency, nextDueOn, anchorDay: day, anchorMonth: month, intervalUnit: ({ weekly: "week", monthly: "month", yearly: "year" } as const)[command.frequency] };
        if (command.id) await tx.update(s.recurringPayments).set(values).where(and(eq(s.recurringPayments.id, command.id), eq(s.recurringPayments.ownerId, owner.id)));
        else await tx.insert(s.recurringPayments).values(values);
        break;
      }
      case "recurring.confirm": {
        const [payment] = await tx.select().from(s.recurringPayments).where(and(eq(s.recurringPayments.id, command.id), eq(s.recurringPayments.ownerId, owner.id)));
        if (!payment) throw new AppError(404, "Платёж не найден.");
        const today = dateKey(new Date(), owner.timezone);
        if (payment.nextDueOn > today) throw new AppError(409, "Этот период уже оплачен или ещё не наступил.");
        const rate = await rateAt(tx, owner.id, payment.currency, new Date());
        await tx.insert(s.financeEntries).values({ ownerId: owner.id, accountId: payment.accountId, categoryId: payment.categoryId, recurringPaymentId: payment.id, name: payment.name, entryType: "expense", amount: payment.amount, currency: payment.currency, usdToPrbRate: rate, occurredAt: new Date(), source: "recurring" });
        const nextDueOn = advanceRecurrenceDate(payment.nextDueOn, payment.intervalUnit as "day" | "week" | "month" | "year", payment.intervalCount, payment.anchorDay, payment.anchorMonth);
        await tx.update(s.recurringPayments).set({ nextDueOn, lastPaidOn: today }).where(eq(s.recurringPayments.id, payment.id));
        break;
      }
      case "day.save": {
        if (command.id) await tx.update(s.workoutDays).set({ name: command.name, weekday: command.weekday }).where(and(eq(s.workoutDays.id, command.id), eq(s.workoutDays.ownerId, owner.id)));
        else { const days = await tx.select().from(s.workoutDays).where(eq(s.workoutDays.ownerId, owner.id)); await tx.insert(s.workoutDays).values({ ownerId: owner.id, name: command.name, weekday: command.weekday, position: days.length }); }
        break;
      }
      case "day.move": {
        const allDays = await tx.select().from(s.workoutDays)
          .where(eq(s.workoutDays.ownerId, owner.id))
          .orderBy(s.workoutDays.position).for("update");
        const days = allDays.filter((day) => !day.isArchived);
        const index = days.findIndex((day) => day.id === command.dayId);
        if (index < 0) throw new AppError(404, "Тренировочный день не найден.");
        const neighbor = days[index + (command.direction === "up" ? -1 : 1)];
        if (!neighbor) break;
        const temporaryPosition = Math.max(...allDays.map((day) => day.position)) + 1;
        if (temporaryPosition > 32767) throw new AppError(409, "Не удалось изменить порядок тренировочных дней.");
        const day = days[index];
        await tx.update(s.workoutDays).set({ position: temporaryPosition }).where(and(eq(s.workoutDays.id, day.id), eq(s.workoutDays.ownerId, owner.id)));
        await tx.update(s.workoutDays).set({ position: day.position }).where(and(eq(s.workoutDays.id, neighbor.id), eq(s.workoutDays.ownerId, owner.id)));
        await tx.update(s.workoutDays).set({ position: neighbor.position }).where(and(eq(s.workoutDays.id, day.id), eq(s.workoutDays.ownerId, owner.id)));
        break;
      }
      case "exercise.add": {
        const [day] = await tx.select().from(s.workoutDays).where(and(eq(s.workoutDays.id, command.dayId), eq(s.workoutDays.ownerId, owner.id)));
        if (!day) throw new AppError(404, "День не найден.");
        await tx.insert(s.exercises).values({ ownerId: owner.id, name: command.name, muscleGroup: command.muscleGroup || null, equipment: command.equipment || null, instructions: command.instructions }).onConflictDoNothing();
        const [exercise] = await tx.select().from(s.exercises).where(and(eq(s.exercises.ownerId, owner.id), eq(s.exercises.name, command.name)));
        const items = await tx.select().from(s.workoutDayExercises).where(eq(s.workoutDayExercises.workoutDayId, day.id));
        await tx.insert(s.workoutDayExercises).values({ ownerId: owner.id, workoutDayId: day.id, exerciseId: exercise.id, position: items.length, plannedSets: command.targetSets, targetRepsMin: command.targetRepetitions, targetRepsMax: command.targetRepetitions, restSeconds: command.restSeconds });
        break;
      }
      case "exercise.replace": {
        const [item] = await tx.select().from(s.workoutDayExercises)
          .where(and(eq(s.workoutDayExercises.id, command.dayExerciseId), eq(s.workoutDayExercises.workoutDayId, command.dayId), eq(s.workoutDayExercises.ownerId, owner.id)))
          .for("update");
        if (!item) throw new AppError(404, "Упражнение в программе не найдено.");
        await tx.insert(s.exercises).values({ ownerId: owner.id, name: command.name, muscleGroup: command.muscleGroup || null, equipment: command.equipment || null, instructions: command.instructions }).onConflictDoNothing();
        const [replacement] = await tx.select().from(s.exercises).where(and(eq(s.exercises.ownerId, owner.id), eq(s.exercises.name, command.name)));
        if (!replacement) throw new AppError(500, "Не удалось сохранить упражнение.");
        await tx.update(s.workoutDayExercises).set({ exerciseId: replacement.id })
          .where(and(eq(s.workoutDayExercises.id, item.id), eq(s.workoutDayExercises.workoutDayId, command.dayId), eq(s.workoutDayExercises.ownerId, owner.id)));
        break;
      }
      case "exercise.move": {
        const items = await tx.select().from(s.workoutDayExercises)
          .where(and(eq(s.workoutDayExercises.ownerId, owner.id), eq(s.workoutDayExercises.workoutDayId, command.dayId)))
          .orderBy(s.workoutDayExercises.position).for("update");
        const index = items.findIndex((item) => item.id === command.dayExerciseId);
        if (index < 0) throw new AppError(404, "Упражнение в программе не найдено.");
        const neighbor = items[index + (command.direction === "up" ? -1 : 1)];
        if (!neighbor) break;
        const temporaryPosition = Math.max(...items.map((item) => item.position)) + 1;
        if (temporaryPosition > 32767) throw new AppError(409, "Не удалось изменить порядок упражнений.");
        const item = items[index];
        await tx.update(s.workoutDayExercises).set({ position: temporaryPosition }).where(and(eq(s.workoutDayExercises.id, item.id), eq(s.workoutDayExercises.ownerId, owner.id)));
        await tx.update(s.workoutDayExercises).set({ position: item.position }).where(and(eq(s.workoutDayExercises.id, neighbor.id), eq(s.workoutDayExercises.ownerId, owner.id)));
        await tx.update(s.workoutDayExercises).set({ position: neighbor.position }).where(and(eq(s.workoutDayExercises.id, item.id), eq(s.workoutDayExercises.ownerId, owner.id)));
        break;
      }
      case "session.start": await startSession(tx, owner.id, command.dayId); break;
      case "set.save": {
        if (![command.repetitions, command.durationSeconds, command.distanceMeters].some((value) => value !== null && value > 0)) throw new AppError(400, "Укажите положительное значение повторений, времени или дистанции.");
        const session = await startSession(tx, owner.id, command.dayId);
        const [item] = await tx.select().from(s.workoutSessionExercises).where(and(eq(s.workoutSessionExercises.sessionId, session.id), eq(s.workoutSessionExercises.workoutDayExerciseId, command.exerciseId)));
        if (!item) throw new AppError(404, "Упражнение не найдено в текущей тренировке.");
        const values = { ownerId: owner.id, sessionExerciseId: item.id, setNumber: command.setIndex, weightKg: command.weightKg === null ? null : String(command.weightKg), repetitions: command.repetitions, durationSeconds: command.durationSeconds, distanceMeters: command.distanceMeters === null ? null : String(command.distanceMeters), isCompleted: true, completedAt: new Date() };
        await tx.insert(s.workoutSets).values(values).onConflictDoUpdate({ target: [s.workoutSets.sessionExerciseId, s.workoutSets.setNumber], set: values });
        break;
      }
      case "session.finish": await tx.update(s.workoutSessions).set({ status: "completed", completedAt: new Date() }).where(and(eq(s.workoutSessions.id, command.id), eq(s.workoutSessions.ownerId, owner.id), eq(s.workoutSessions.status, "active"))); break;
      case "draft.reject": await tx.update(s.captureDrafts).set({ status: "cancelled" }).where(and(eq(s.captureDrafts.id, command.id), eq(s.captureDrafts.ownerId, owner.id), eq(s.captureDrafts.status, "pending"))); break;
      case "draft.money-category.set": await setPendingMoneyDraftCategory(tx, owner.id, command.id, command.category); break;
      case "draft.confirm": {
        const [draft] = await tx.select().from(s.captureDrafts).where(and(eq(s.captureDrafts.id, command.id), eq(s.captureDrafts.ownerId, owner.id))).for("update");
        if (!draft) throw new AppError(404, "Черновик не найден.");
        if (draft.status === "confirmed") break;
        if (draft.status !== "pending") throw new AppError(409, "Черновик уже отменён.");
        const [food] = await tx.select().from(s.nutritionDrafts).where(eq(s.nutritionDrafts.captureDraftId, draft.id));
        const [money] = await tx.select().from(s.moneyDrafts).where(eq(s.moneyDrafts.captureDraftId, draft.id));
        if (food) await tx.insert(s.nutritionEntries).values({ ownerId: owner.id, captureDraftId: draft.id, name: food.name, portionLabel: food.portionLabel, ...macroStrings(macroNumbers(food)), occurredAt: food.occurredAt, estimated: food.estimated });
        if (money) {
          if (!money.proposedCategory && !money.categoryId) throw new AppError(400, missingMoneyCategoryMessage(money.entryType === "income" ? "income" : "expense"));
          const chosen = await account(tx, owner.id, money.accountId ?? undefined, money.currency);
          const group = money.categoryId ? null : await category(tx, owner.id, money.proposedCategory!, money.entryType as "expense" | "income");
          const rate = await rateAt(tx, owner.id, chosen.currency, money.occurredAt);
          await tx.insert(s.financeEntries).values({ ownerId: owner.id, captureDraftId: draft.id, accountId: chosen.id, categoryId: money.categoryId ?? group!.id, entryType: money.entryType, name: money.name, amount: money.amount, currency: chosen.currency, usdToPrbRate: rate, occurredAt: money.occurredAt });
        }
        await tx.update(s.captureDrafts).set({ status: "confirmed", confirmedAt: new Date() }).where(eq(s.captureDrafts.id, draft.id));
        break;
      }
      case "template.save": {
        const [entry] = await tx.select().from(s.nutritionEntries).where(and(eq(s.nutritionEntries.id, command.foodEntryId), eq(s.nutritionEntries.ownerId, owner.id)));
        if (!entry) throw new AppError(404, "Запись еды не найдена.");
        const values = { ownerId: owner.id, name: command.name, portionLabel: entry.portionLabel, ...macroStrings(macroNumbers(entry)), composition: entry.composition };
        await tx.insert(s.foodTemplates).values(values).onConflictDoUpdate({ target: [s.foodTemplates.ownerId, s.foodTemplates.name], set: values });
        break;
      }
    }
  });
}
