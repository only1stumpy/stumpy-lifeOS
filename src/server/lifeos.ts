import { and, desc, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { getDb, type Transaction } from "@/db/client";
import * as s from "@/db/schema";
import type { AppSnapshot } from "@/domain/app";
import type { AppCommand } from "@/domain/commands";
import type { FinanceDebt, MacroValues, FoodLogEntry, WorkoutDay } from "@/domain/types";
import { currencyUnit } from "@/domain/currencies";
import { convertToBaseMinor, dateKey, sumMacros, weightStampToDate } from "@/domain/math";
import { shouldSuggestLoadIncrease } from "@/domain/progression";
import { ACTIVITY_LEVELS, GOALS, ageOn, type NutritionProfile } from "@/domain/nutrition";
import { disabledModulesMessage, filterEntriesByModules, normalizeDisabledFeatures, normalizeModules, resolveFeatures } from "@/domain/modules";
import { AppError, assertConsent } from "./http";
import { draftExpiresAt } from "./retention";
import { CONSENT_EXEMPT_COMMANDS } from "@/domain/privacy";
import { analyzeMessage } from "./ai/analyze";
import { AIAnalysisError, type AnalyzeMessageInput } from "./ai/types";
import { parseFinancePlanList, stripFinancePlanMarker, type FinancePlanInput } from "@/domain/finance-plans";
import { activeClarificationHistory, nextClarificationHistory } from "./ai/clarification";
import { resolveTelegramUserId } from "./owner-context";
import { enforceRateLimit, RATE_LIMITS } from "./rate-limit";
import { loadConfiguredAiProviderConfigs } from "./ai/provider-accounts";
import { debtRemainingMinor } from "@/domain/debts";
import type { DebtMessageIntent } from "@/domain/debt-message";
import { account, baseCurrencyOf, debtAmountFromMinor, decimal, macroNumbers, macroStrings, toMinor } from "./commands/shared";
import { dispatch } from "./commands";
import { buildGymReports, indexGymHistory } from "./gym-reports";
export { deleteOwnerData } from "./commands/settings";
export { missingMoneyCategoryMessage, setPendingMoneyDraftCategory } from "./commands/drafts";

/** Saved calculator parameters without body weight; the latest weight entry supplies it. Incomplete or legacy values yield null fields. */
export function storedProfile(owner: typeof s.ownerSettings.$inferSelect, today: string): Partial<Omit<NutritionProfile, "weightKg">> {
  return {
    sex: owner.sex === "male" || owner.sex === "female" ? owner.sex : undefined,
    age: owner.dateOfBirth ? ageOn(owner.dateOfBirth, today) : undefined,
    heightCm: owner.heightCm ? Number(owner.heightCm) : undefined,
    activityLevel: owner.activityLevel && owner.activityLevel in ACTIVITY_LEVELS ? owner.activityLevel as NutritionProfile["activityLevel"] : undefined,
    goalType: owner.goalType in GOALS ? owner.goalType as NutritionProfile["goalType"] : undefined,
  };
}


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
  const [existing] = await db.select().from(s.ownerSettings).where(eq(s.ownerSettings.telegramUserId, telegramUserId));
  if (existing) return existing;
  // Open registration: cap how many new profiles can be created per hour across all users.
  await enforceRateLimit(RATE_LIMITS.newProfiles, "all");
  await db.insert(s.ownerSettings).values({ telegramUserId }).onConflictDoNothing();
  const [owner] = await db.select().from(s.ownerSettings).where(eq(s.ownerSettings.telegramUserId, telegramUserId));
  if (!owner) throw new AppError(503, "Не удалось загрузить профиль.");
  return owner;
}

/** Remembers only the UTC date of the user's last visit (at most one tiny update per user per day); the cron never calls it. */
export async function touchActivity(owner: { id: string; lastActiveDate: string | null }, now: Date = new Date()): Promise<void> {
  const today = now.toISOString().slice(0, 10);
  if (owner.lastActiveDate === today) return;
  await getDb().update(s.ownerSettings).set({ lastActiveDate: today }).where(eq(s.ownerSettings.id, owner.id)).catch(() => undefined);
}

/** How many of the newest finance entries the snapshot carries to the client. */
export const MAX_SNAPSHOT_FINANCE_ENTRIES = 1000;

type DraftRows = {
  captures: (typeof s.captureDrafts.$inferSelect)[];
  foodDrafts: (typeof s.nutritionDrafts.$inferSelect)[];
  moneyDrafts: (typeof s.moneyDrafts.$inferSelect)[];
  debtDrafts: (typeof s.financeDebtDrafts.$inferSelect)[];
  categories: (typeof s.financeCategories.$inferSelect)[];
  debts: (typeof s.financeDebts.$inferSelect)[];
  repayments: (typeof s.financeDebtRepayments.$inferSelect)[];
};

function buildDrafts(
  captures: DraftRows["captures"], foodDrafts: DraftRows["foodDrafts"], moneyDrafts: DraftRows["moneyDrafts"], debtDrafts: DraftRows["debtDrafts"],
  categories: DraftRows["categories"], debts: DraftRows["debts"], repayments: DraftRows["repayments"],
): AppSnapshot["drafts"] {
  return captures.map((v) => {
    const food = foodDrafts.find((f) => f.captureDraftId === v.id);
    const entry = moneyDrafts.find((m) => m.captureDraftId === v.id);
    const debt = debtDrafts.find((d) => d.captureDraftId === v.id);
    const linkedDebt = debt?.debtId ? debts.find((item) => item.id === debt.debtId) : null;
    const repaidMinor = debt?.debtId ? repayments
      .filter((repayment) => repayment.debtId === debt.debtId)
      .reduce((sum, repayment) => sum + toMinor(repayment.amount), 0) : 0;
    // A purchase plan draft reuses the money draft row (name, amount in the base currency) and becomes a plan on confirmation.
    const plan = v.kind === "plan" && entry ? { name: entry.name, amountMinor: toMinor(entry.amount) } : null;
    return { id: v.id, description: v.messageText ?? "", occurredAt: (food?.occurredAt ?? entry?.occurredAt ?? debt?.occurredAt ?? v.createdAt).toISOString(),
      food: food ? { label: food.name, portionLabel: food.portionLabel, ...macroNumbers(food), estimated: food.estimated } : null,
      plan,
      money: entry && !plan ? { label: entry.name, amountMinor: toMinor(entry.amount), currency: entry.currency, kind: entry.entryType as "expense" | "income", category: categories.find((c) => c.id === entry.categoryId)?.name ?? entry.proposedCategory } : null,
      debt: debt ? {
        operation: debt.operation as "create" | "repayment",
        personName: debt.personName,
        direction: debt.direction as FinanceDebt["direction"],
        amountMinor: toMinor(debt.amount),
        openedAs: debt.openedAs as "transfer" | "opening_balance" | null,
        debtId: debt.debtId,
        dueOn: debt.dueOn,
        note: debt.note,
        remainingAmountMinor: linkedDebt ? debtRemainingMinor(toMinor(linkedDebt.originalAmount), [repaidMinor]) : null,
      } : null };
  });
}

/** Pending drafts only (optionally a subset): a few targeted queries instead of the whole snapshot. */
export async function loadPendingDrafts(ids?: readonly string[]): Promise<AppSnapshot["drafts"]> {
  if (ids && ids.length === 0) return [];
  const owner = await ensureOwner();
  const db = getDb();
  const ownerId = owner.id;
  const captures = await db.select().from(s.captureDrafts)
    .where(and(eq(s.captureDrafts.ownerId, ownerId), eq(s.captureDrafts.status, "pending"), ...(ids ? [inArray(s.captureDrafts.id, [...ids])] : [])))
    .orderBy(s.captureDrafts.createdAt);
  if (!captures.length) return [];
  const captureIds = captures.map((v) => v.id);
  const [foodDrafts, moneyDrafts, debtDrafts, categories] = await Promise.all([
    db.select().from(s.nutritionDrafts).where(and(eq(s.nutritionDrafts.ownerId, ownerId), inArray(s.nutritionDrafts.captureDraftId, captureIds))),
    db.select().from(s.moneyDrafts).where(and(eq(s.moneyDrafts.ownerId, ownerId), inArray(s.moneyDrafts.captureDraftId, captureIds))),
    db.select().from(s.financeDebtDrafts).where(and(eq(s.financeDebtDrafts.ownerId, ownerId), inArray(s.financeDebtDrafts.captureDraftId, captureIds))),
    db.select().from(s.financeCategories).where(eq(s.financeCategories.ownerId, ownerId)),
  ]);
  const debtIds = debtDrafts.map((v) => v.debtId).filter((v): v is string => !!v);
  const [debts, repayments] = debtIds.length
    ? await Promise.all([
      db.select().from(s.financeDebts).where(and(eq(s.financeDebts.ownerId, ownerId), inArray(s.financeDebts.id, debtIds))),
      db.select().from(s.financeDebtRepayments).where(and(eq(s.financeDebtRepayments.ownerId, ownerId), inArray(s.financeDebtRepayments.debtId, debtIds))),
    ])
    : [[], []];
  return buildDrafts(captures, foodDrafts, moneyDrafts, debtDrafts, categories, debts, repayments);
}

export async function loadSnapshot(selectedDate?: string): Promise<AppSnapshot> {
  const owner = await ensureOwner();
  const db = getDb();
  const ownerId = owner.id;
  const today = dateKey(new Date(), owner.timezone);
  if (selectedDate && (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate) || !Number.isFinite(Date.parse(selectedDate + "T12:00:00Z")) || new Date(selectedDate + "T12:00:00Z").toISOString().slice(0, 10) !== selectedDate)) throw new AppError(400, "Некорректная дата дневника.");
  const localDate = selectedDate && /^\d{4}-\d{2}-\d{2}$/.test(selectedDate) ? selectedDate : today;
  // ponytail: a personal journal is read as a whole; add paginated history when its size warrants it.
  const [foods, targets, weights, accounts, categories, money, rates, recurring, plans, debts, repayments, days, dayItems, exercises, sessions, sessionItems, sets, captures, foodDrafts, moneyDrafts, debtDrafts, templates] = await Promise.all([
    db.select().from(s.nutritionEntries).where(eq(s.nutritionEntries.ownerId, ownerId)).orderBy(desc(s.nutritionEntries.occurredAt)),
    db.select().from(s.nutritionTargets).where(and(eq(s.nutritionTargets.ownerId, ownerId), lte(s.nutritionTargets.effectiveFrom, localDate))).orderBy(desc(s.nutritionTargets.effectiveFrom)),
    db.select().from(s.weightEntries).where(eq(s.weightEntries.ownerId, ownerId)).orderBy(s.weightEntries.occurredAt),
    db.select().from(s.financeAccounts).where(and(eq(s.financeAccounts.ownerId, ownerId), eq(s.financeAccounts.isArchived, false))),
    db.select().from(s.financeCategories).where(eq(s.financeCategories.ownerId, ownerId)),
    db.select().from(s.financeEntries).where(eq(s.financeEntries.ownerId, ownerId)).orderBy(desc(s.financeEntries.occurredAt)),
    db.select().from(s.exchangeRates).where(eq(s.exchangeRates.ownerId, ownerId)).orderBy(desc(s.exchangeRates.effectiveAt)),
    db.select().from(s.recurringPayments).where(and(eq(s.recurringPayments.ownerId, ownerId), eq(s.recurringPayments.isActive, true))),
    db.select().from(s.financePlans).where(eq(s.financePlans.ownerId, ownerId)).orderBy(s.financePlans.createdAt),
    db.select().from(s.financeDebts).where(eq(s.financeDebts.ownerId, ownerId)).orderBy(s.financeDebts.createdAt),
    db.select().from(s.financeDebtRepayments).where(eq(s.financeDebtRepayments.ownerId, ownerId)),
    db.select().from(s.workoutDays).where(and(eq(s.workoutDays.ownerId, ownerId), eq(s.workoutDays.isArchived, false))).orderBy(s.workoutDays.position),
    db.select().from(s.workoutDayExercises).where(eq(s.workoutDayExercises.ownerId, ownerId)).orderBy(s.workoutDayExercises.position),
    db.select().from(s.exercises).where(eq(s.exercises.ownerId, ownerId)),
    db.select().from(s.workoutSessions).where(eq(s.workoutSessions.ownerId, ownerId)).orderBy(desc(s.workoutSessions.startedAt)),
    db.select().from(s.workoutSessionExercises).where(eq(s.workoutSessionExercises.ownerId, ownerId)),
    db.select().from(s.workoutSets).where(eq(s.workoutSets.ownerId, ownerId)),
    db.select().from(s.captureDrafts).where(and(eq(s.captureDrafts.ownerId, ownerId), eq(s.captureDrafts.status, "pending"))).orderBy(s.captureDrafts.createdAt),
    db.select().from(s.nutritionDrafts).where(eq(s.nutritionDrafts.ownerId, ownerId)),
    db.select().from(s.moneyDrafts).where(eq(s.moneyDrafts.ownerId, ownerId)),
    db.select().from(s.financeDebtDrafts).where(eq(s.financeDebtDrafts.ownerId, ownerId)),
    db.select().from(s.foodTemplates).where(eq(s.foodTemplates.ownerId, ownerId)),
  ]);
  const active = sessions.find((v) => v.status === "active");
  const last = sessions.find((v) => v.status === "completed");
  const gymIndex = indexGymHistory(sessions, sessionItems, sets);
  const program: WorkoutDay[] = days.map((day) => ({
    id: day.id, name: day.name, weekday: day.weekday,
    exercises: dayItems.filter((i) => i.workoutDayId === day.id).map((item) => {
      const exercise = exercises.find((e) => e.id === item.exerciseId)!;
      const activeItem = sessionItems.find((i) => i.sessionId === active?.id && i.workoutDayExerciseId === item.id);
      const previousItem = gymIndex.previousItemByExercise.get(item.exerciseId);
      const previousSets = (previousItem ? gymIndex.setsByItem.get(previousItem.id) ?? [] : []).filter((v) => v.isCompleted).sort((a, b) => a.setNumber - b.setNumber);
      const progressionHint = item.targetRepsMax !== null && shouldSuggestLoadIncrease(previousSets, item.plannedSets, item.targetRepsMax)
        ? "В прошлый раз все подходы достигли верхней границы повторений — можно попробовать немного увеличить вес."
        : null;
      return {
        id: item.id, name: activeItem?.exerciseName ?? exercise?.name ?? "Упражнение", restSeconds: item.restSeconds ?? 90, targetRepetitions: item.targetRepsMax ?? item.targetRepsMin ?? null,
        previousPerformance: previousSets.length ? previousSets.map((v) => v.weightKg !== null ? Number(v.weightKg) + " кг × " + (v.repetitions ?? "—") : (v.durationSeconds ?? 0) + " с").join(", ") : null,
        progressionHint,
        sets: Array.from({ length: item.plannedSets }, (_, i) => {
          const current = activeItem ? (gymIndex.setsByItem.get(activeItem.id) ?? []).find((v) => v.setNumber === i + 1) : undefined;
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
  const baseCurrency = owner.baseCurrency ?? accounts[0]?.currency ?? "USD";
  const latestRates: Record<string, string> = {};
  for (const r of rates) if (!(r.currency in latestRates)) latestRates[r.currency] = r.rateToBase;
  const totalExpenses = (rows: typeof expenses) => rows.reduce((sum, v) => sum + convertToBaseMinor(toMinor(v.amount), v.currency, baseCurrency, v.rateToBase), 0);
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
  const gymReports = buildGymReports({ sessions, items: sessionItems, sets, exercises }, (date) => dateKey(date, owner.timezone));
  const reports: AppSnapshot["reports"] = {
    nutritionDays: buildNutritionHistoryDays(foods.map((food) => ({ occurredAt: food.occurredAt, macros: macroNumbers(food) })), owner.timezone, localDate),
    expenseDays: calendar.map((date) => ({ date, amountMinor: totalExpenses(expenses.filter((v) => dateKey(v.occurredAt, owner.timezone) === date)) })),
    expenseCategories: categories.map((category) => ({ name: category.name, amountMinor: totalExpenses(monthlyExpenses.filter((v) => v.categoryId === category.id)) })).filter((v) => v.amountMinor > 0).sort((a, b) => b.amountMinor - a.amountMinor),
    monthComparison: { currentMinor: totalExpenses(monthlyExpenses.filter((v) => dateKey(v.occurredAt, owner.timezone) <= localDate)), previousMinor: totalExpenses(previousExpenses), previousPeriodEnd },
    repeatPurchases: repeated,
    largestPurchases: monthlyExpenses.map((v) => ({ name: v.name, amountMinor: totalExpenses([v]), occurredAt: v.occurredAt.toISOString() })).sort((a, b) => b.amountMinor - a.amountMinor).slice(0, 5),
    workoutHistory: gymReports.workoutHistory,
    exerciseProgress: gymReports.exerciseProgress,
  };
  const localWeekday = new Date(localDate + "T12:00:00Z").getUTCDay();
  const planned = days.find((v) => v.weekday === localWeekday);
  return {
    localDate,
    reports,
    nutrition: { consumed: sumMacros(foodEntries), target: targets[0] ? macroNumbers(targets[0]) : null, entries: foodEntries, bodyWeightKg: weights.length ? Number(weights[weights.length - 1].weightKg) : null, weightHistory: weights.map((v) => ({ date: weightStampToDate(v.occurredAt), weightKg: Number(v.weightKg) })) },
    finance: {
      spentTodayMinor: totalExpenses(expenses.filter((v) => dateKey(v.occurredAt, owner.timezone) === localDate)),
      spentMonthMinor: totalExpenses(monthlyExpenses),
      accounts: accounts.map((v) => ({ id: v.id, name: v.name, currency: v.currency, openingBalanceMinor: toMinor(v.openingBalance), isDefault: v.isDefault, balanceMinor: toMinor(v.openingBalance) + money.filter((e) => e.accountId === v.id).reduce((sum, e) => sum + (e.entryType === "income" ? 1 : -1) * toMinor(e.amount), 0) })),
      // Balances and reports use every entry; only the list sent to the client is capped to keep the payload bounded.
      entries: money.slice(0, MAX_SNAPSHOT_FINANCE_ENTRIES).map((v) => ({ id: v.id, accountId: v.accountId, label: v.name, occurredAt: v.occurredAt.toISOString(), amountMinor: toMinor(v.amount), currency: v.currency, category: categories.find((c) => c.id === v.categoryId)?.name ?? "Без категории", kind: v.entryType as "expense" | "income" })),
      plans: plans.map((v) => ({ id: v.id, name: v.name, amountMinor: toMinor(v.amount) })),
      debts: debts.map((v): FinanceDebt => {
        const own = repayments.filter((repayment) => repayment.debtId === v.id).sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
        const originalAmountMinor = toMinor(v.originalAmount);
        return {
          id: v.id,
          personName: v.personName,
          direction: v.direction as FinanceDebt["direction"],
          originalAmountMinor,
          remainingAmountMinor: debtRemainingMinor(originalAmountMinor, own.map((repayment) => toMinor(repayment.amount))),
          repayments: own.map((repayment) => ({ id: repayment.id, amountMinor: toMinor(repayment.amount), occurredAt: repayment.occurredAt.toISOString() })),
          dueOn: v.dueOn,
          note: v.note,
          createdAt: v.createdAt.toISOString(),
        };
      }),
    },
    gym: {
      trainingDay: Boolean(active || planned), nextWorkout: program.find((v) => v.id === (active?.workoutDayId ?? planned?.id)) ?? null,
      lastWorkout: last ? { name: last.name, completedAt: last.completedAt!.toISOString(), summary: sets.filter((v) => v.isCompleted && sessionItems.some((i) => i.sessionId === last.id && i.id === v.sessionExerciseId)).length + " подходов" } : null,
      program,
    },
    settings: { timeZone: owner.timezone, baseCurrency, rates: latestRates, defaultAccountId: accounts.find((v) => v.isDefault)?.id ?? accounts[0]?.id ?? null, aiOnboardingCompleted: owner.aiOnboardingCompleted, profileOnboardingCompleted: owner.profileOnboardingCompleted, profile: storedProfile(owner, today), notificationsConfigured: owner.notificationsConfigured, notifications: { dailySummary: owner.dailySummaryEnabled, weeklySummary: owner.weeklySummaryEnabled, weightReminder: owner.weightReminderEnabled, summaryTime: owner.summaryTime }, lastSeenVersion: owner.lastSeenVersion, privacyAcceptedVersion: owner.privacyPolicyVersion, healthConsentVersion: owner.healthConsentVersion, enabledModules: normalizeModules(owner.enabledModules), modulesConfigured: owner.modulesConfigured, enabledFeatures: resolveFeatures(normalizeModules(owner.enabledModules), owner.disabledFeatures), disabledFeatures: normalizeDisabledFeatures(owner.disabledFeatures) },
    recurring: recurring.map((v) => ({ id: v.id, name: v.name, amountMinor: toMinor(v.amount), accountId: v.accountId, currency: v.currency, category: categories.find((c) => c.id === v.categoryId)?.name ?? "", frequency: ({ week: "weekly", month: "monthly", year: "yearly" } as const)[v.intervalUnit as "week" | "month" | "year"] ?? "monthly", nextDueAt: v.nextDueOn + "T12:00:00Z" })),
    drafts: buildDrafts(captures, foodDrafts, moneyDrafts, debtDrafts, categories, debts, repayments),
    templates: templates.map((v) => ({ id: v.id, name: v.name, portionLabel: v.portionLabel, calories: Number(v.calories), proteinGrams: Number(v.proteinGrams), fatGrams: Number(v.fatGrams), carbsGrams: Number(v.carbsGrams) })),
    activeSession: active?.workoutDayId ? { id: active.id, dayId: active.workoutDayId, startedAt: active.startedAt.toISOString() } : null,
  };
}

export async function createDebtCaptureDraft(input: {
  intent: DebtMessageIntent;
  messageText: string;
  telegramUpdateRowId?: string;
}): Promise<{ draftIds: string[]; clarification?: string }> {
  const owner = await ensureOwner();
  return getDb().transaction(async (tx) => {
    // A retried Telegram update must not add a second draft for the same message.
    if (input.telegramUpdateRowId) {
      const stored = await tx.select({ id: s.captureDrafts.id }).from(s.captureDrafts)
        .where(and(eq(s.captureDrafts.ownerId, owner.id), eq(s.captureDrafts.telegramUpdateRowId, input.telegramUpdateRowId)));
      if (stored.length) return { draftIds: stored.map((row) => row.id) };
    }
    let debt: typeof s.financeDebts.$inferSelect | undefined;
    let accountId: string | null = null;
    if (input.intent.kind === "repayment") {
      const debts = await tx.select().from(s.financeDebts).where(eq(s.financeDebts.ownerId, owner.id));
      const repayments = await tx.select().from(s.financeDebtRepayments).where(eq(s.financeDebtRepayments.ownerId, owner.id));
      const personKey = input.intent.personName.trim().toLocaleLowerCase("ru");
      const matching = debts.filter((item) => {
        const samePerson = item.personName.trim().toLocaleLowerCase("ru") === personKey;
        const sameDirection = input.intent.direction === null || item.direction === input.intent.direction;
        const remaining = debtRemainingMinor(toMinor(item.originalAmount), repayments.filter((row) => row.debtId === item.id).map((row) => toMinor(row.amount)));
        return samePerson && sameDirection && remaining > 0;
      });
      if (!matching.length) return { draftIds: [], clarification: `Не нашёл открытый долг для «${input.intent.personName}». Проверь имя или открой «Финансы → Долги».` };
      if (matching.length > 1) return { draftIds: [], clarification: `У тебя несколько открытых долгов для «${input.intent.personName}». Выбери нужный в «Финансы → Долги», чтобы возврат попал куда надо.` };
      debt = matching[0];
      const remaining = debtRemainingMinor(toMinor(debt.originalAmount), repayments.filter((row) => row.debtId === debt!.id).map((row) => toMinor(row.amount)));
      if (input.intent.amountMinor > remaining) {
        return { draftIds: [], clarification: `Сумма возврата больше остатка долга (${decimal(remaining)} ${currencyUnit(await baseCurrencyOf(tx, owner.id))}). Проверь сумму и попробуй ещё раз.` };
      }
      const chosen = await account(tx, owner.id, undefined, await baseCurrencyOf(tx, owner.id));
      accountId = chosen.id;
    } else if (input.intent.openedAs === "transfer") {
      const chosen = await account(tx, owner.id, undefined, await baseCurrencyOf(tx, owner.id));
      accountId = chosen.id;
    }

    const [capture] = await tx.insert(s.captureDrafts).values({
      ownerId: owner.id,
      telegramUpdateRowId: input.telegramUpdateRowId,
      kind: "debt",
      messageText: input.messageText,
      expiresAt: draftExpiresAt(),
    }).returning();
    const intent = input.intent;
    await tx.insert(s.financeDebtDrafts).values({
      ownerId: owner.id,
      captureDraftId: capture.id,
      operation: intent.kind,
      personName: intent.kind === "repayment" ? debt!.personName : intent.personName,
      direction: intent.kind === "repayment" ? debt!.direction : intent.direction,
      amount: debtAmountFromMinor(intent.amountMinor),
      openedAs: intent.kind === "create" ? intent.openedAs : null,
      debtId: intent.kind === "repayment" ? debt!.id : null,
      accountId,
      dueOn: intent.kind === "create" ? intent.dueOn : null,
      note: intent.kind === "create" ? intent.note : null,
      occurredAt: new Date(),
    });
    return { draftIds: [capture.id] };
  });
}

/**
 * «Запиши в планы …» with one or several purchases: every position becomes its own pending draft.
 * The user's AI splits the text (Zod-validated inside `analyzeMessage`); without AI the list is split line by line.
 */
export async function createPlanCaptureDrafts(input: { text: string; telegramUpdateRowId?: string; messageAt?: Date }): Promise<{ draftIds: string[]; clarification?: string }> {
  const owner = await ensureOwner();
  const db = getDb();
  if (input.telegramUpdateRowId) {
    const stored = await db.select({ id: s.captureDrafts.id }).from(s.captureDrafts)
      .where(and(eq(s.captureDrafts.ownerId, owner.id), eq(s.captureDrafts.telegramUpdateRowId, input.telegramUpdateRowId)));
    if (stored.length) return { draftIds: stored.map((row) => row.id) };
  }
  const baseCurrency = owner.baseCurrency ?? "";
  const body = stripFinancePlanMarker(input.text);
  let items: FinancePlanInput[] = [];
  const foreign: string[] = [];
  let failed: string[] = [];
  try {
    const analysis = await analyzeMessage({
      text: body,
      enabledModules: ["finance"],
      baseCurrency: baseCurrency || "USD",
      now: (input.messageAt ?? new Date()).toISOString(),
      timeZone: owner.timezone,
      templates: [],
      categories: [],
    }, { profiles: await loadConfiguredAiProviderConfigs(owner.id), ownerId: owner.id });
    for (const entry of analysis.entries) {
      if (!entry.money || entry.money.kind !== "expense") continue;
      if (baseCurrency && entry.money.currency !== baseCurrency) foreign.push(entry.money.label);
      else items.push({ name: entry.money.label.slice(0, 300), amountMinor: entry.money.amountMinor });
    }
  } catch (error) {
    if (!(error instanceof AIAnalysisError)) throw error;
  }
  if (!items.length && !foreign.length) {
    ({ items, failed } = parseFinancePlanList(input.text));
  }
  items = items.slice(0, 40);
  if (!items.length) {
    return {
      draftIds: [],
      clarification: foreign.length
        ? `Планы ведутся в основной валюте (${baseCurrency}). Напиши цены в ней: ${foreign.join(", ")}.`
        : "Не разобрал название или цену. Напиши, например: «Запиши в планы шампунь за 220р». Несколько покупок — каждую с новой строки. План не влияет на расходы, пока не отметишь покупку.",
    };
  }
  const draftIds: string[] = [];
  await db.transaction(async (tx) => {
    for (const item of items) {
      const [capture] = await tx.insert(s.captureDrafts).values({ ownerId: owner.id, telegramUpdateRowId: input.telegramUpdateRowId, kind: "plan", messageText: input.text, expiresAt: draftExpiresAt() }).returning();
      draftIds.push(capture.id);
      await tx.insert(s.moneyDrafts).values({ ownerId: owner.id, captureDraftId: capture.id, name: item.name, entryType: "expense", amount: decimal(item.amountMinor), currency: baseCurrency || "USD" });
    }
  });
  const skipped = [...failed, ...foreign.map((name) => `${name} (не в ${baseCurrency})`)];
  return { draftIds, clarification: skipped.length ? `Не разобрал: ${skipped.join("; ")}. Добавь их отдельным сообщением.` : undefined };
}

/** «Исправить» on a plan draft: the next message replaces its name and price. Returns false if the draft is not a pending plan. */
export async function correctPlanDraft(draftId: string, text: string): Promise<{ ok: boolean; item?: FinancePlanInput }> {
  const owner = await ensureOwner();
  const db = getDb();
  const [capture] = await db.select().from(s.captureDrafts)
    .where(and(eq(s.captureDrafts.id, draftId), eq(s.captureDrafts.ownerId, owner.id), eq(s.captureDrafts.status, "pending"), eq(s.captureDrafts.kind, "plan")));
  if (!capture) return { ok: false };
  const { items } = parseFinancePlanList(text);
  if (items.length !== 1) throw new AppError(400, "Напиши одну покупку с ценой, например: «шампунь 220р».");
  await db.update(s.moneyDrafts).set({ name: items[0].name, amount: decimal(items[0].amountMinor) })
    .where(and(eq(s.moneyDrafts.captureDraftId, draftId), eq(s.moneyDrafts.ownerId, owner.id)));
  return { ok: true, item: items[0] };
}

/** `messageAt` is when the user wrote the message; a retried update must not be analysed as if it were sent now. */
export async function analyzeCapture(input: Pick<AnalyzeMessageInput, "text" | "image"> & { previousDraftId?: string; telegramUpdateRowId?: string; messageAt?: Date }) {
  const owner = await ensureOwner();
  if (input.telegramUpdateRowId) {
    const stored = await getDb().select().from(s.captureDrafts).where(and(eq(s.captureDrafts.ownerId, owner.id), eq(s.captureDrafts.telegramUpdateRowId, input.telegramUpdateRowId)));
    if (stored.length) return { entries: [], clarification: null, provider: null, model: null, draftIds: stored.map((v) => v.id) };
  }
  const db = getDb();
  // Targeted reads: the whole snapshot (every table, whole history) is not needed to parse one message.
  const [templates, accounts, categoryRows, previousDrafts] = await Promise.all([
    db.select().from(s.foodTemplates).where(eq(s.foodTemplates.ownerId, owner.id)),
    db.select().from(s.financeAccounts).where(and(eq(s.financeAccounts.ownerId, owner.id), eq(s.financeAccounts.isArchived, false))),
    db.select({ name: s.financeCategories.name }).from(s.financeCategories).where(eq(s.financeCategories.ownerId, owner.id)),
    input.previousDraftId ? loadPendingDrafts([input.previousDraftId]) : Promise.resolve([]),
  ]);
  const baseCurrency = owner.baseCurrency ?? accounts[0]?.currency ?? "USD";
  const defaultAccountId = accounts.find((v) => v.isDefault)?.id ?? accounts[0]?.id ?? null;
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
  const modules = normalizeModules(owner.enabledModules);
  const rawAnalysis = await analyzeMessage({ ...input, enabledModules: modules, baseCurrency, now: (input.messageAt ?? analyzedAt).toISOString(), timeZone: owner.timezone, clarificationHistory: clarificationHistory ?? undefined, templates: templates.map((v) => ({ name: v.name, portionLabel: v.portionLabel, ...macroNumbers(v) })), categories: [...new Set(categoryRows.map((v) => v.name))], previousDraft: previousDrafts[0] }, {
    profiles: providerProfiles,
    ownerId: owner.id,
  });
  const allowed = filterEntriesByModules(rawAnalysis.entries, modules);
  const analysis = { ...rawAnalysis, entries: allowed.entries };
  if (!analysis.entries.length && allowed.blocked.length) {
    return { ...analysis, clarification: disabledModulesMessage(allowed.blocked), draftIds: [] as string[] };
  }
  if (!analysis.entries.length) {
    const nextHistory = nextClarificationHistory(clarificationHistory, input.text, analysis.clarification, false);
    await getDb().update(s.ownerSettings)
      .set({ aiClarificationHistory: nextHistory, aiClarificationUpdatedAt: nextHistory ? analyzedAt : null, updatedAt: analyzedAt })
      .where(eq(s.ownerSettings.id, owner.id));
    return { ...analysis, draftIds: [] as string[] };
  }
  // A draft in a currency without an account cannot be saved: say so now, not after the «Записать» button.
  const noAccount = analysis.entries.find((entry) => entry.money && !accounts.some((v) => v.currency === entry.money!.currency));
  if (noAccount?.money) {
    const code = noAccount.money.currency;
    throw new AppError(400, `Нет счёта в валюте ${code}. Добавь такой счёт в LifeOS или напиши сумму без валюты — она запишется в ${baseCurrency}.`);
  }
  const draftIds: string[] = [];
  await getDb().transaction(async (tx) => {
    if (input.previousDraftId) await tx.update(s.captureDrafts).set({ status: "cancelled", messageText: null }).where(and(eq(s.captureDrafts.ownerId, owner.id), eq(s.captureDrafts.id, input.previousDraftId), eq(s.captureDrafts.status, "pending")));
    // Food and money from one message always become separate drafts, so each has its own «Записать» and «Отменить».
    const separated = analysis.entries.flatMap((entry) => entry.food && entry.money
      ? [{ ...entry, money: null }, { ...entry, food: null }]
      : [entry]);
    for (const entry of separated) {
      const [capture] = await tx.insert(s.captureDrafts).values({ ownerId: owner.id, telegramUpdateRowId: input.telegramUpdateRowId, kind: entry.food ? "nutrition" : "finance", messageText: input.text, expiresAt: draftExpiresAt() }).returning();
      draftIds.push(capture.id);
      const occurredAt = new Date(entry.occurredAt);
      if (entry.food) await tx.insert(s.nutritionDrafts).values({ ownerId: owner.id, captureDraftId: capture.id, name: entry.food.label, portionLabel: entry.food.portionLabel, ...macroStrings(entry.food), estimated: entry.food.estimated, occurredAt });
      if (entry.money) {
        const chosen = accounts.find((v) => v.id === defaultAccountId && v.currency === entry.money!.currency) ?? accounts.find((v) => v.currency === entry.money!.currency);
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

/** Commands that can store an operation together with a conversion rate. */
const CONVERTING_COMMANDS = new Set(["money.save", "draft.confirm", "recurring.confirm"]);

/** Rejects an amount whose value in the base currency (minor units × rate) is not an exact integer in JS. */
async function assertBaseAmountsSafe(tx: Transaction, ownerId: string) {
  const [unsafe] = await tx.select({ id: s.financeEntries.id }).from(s.financeEntries)
    .where(and(eq(s.financeEntries.ownerId, ownerId), isNotNull(s.financeEntries.rateToBase), sql`abs(${s.financeEntries.amount} * ${s.financeEntries.rateToBase} * 100) > 9007199254740991`))
    .limit(1);
  if (unsafe) throw new AppError(400, "Сумма с учётом курса слишком велика. Уменьши сумму или проверь курс валюты.");
}

/**
 * Runs one command in the owner transaction. A request id (from the client, or `requestId` for bot updates)
 * makes a repeated call a no-op: the id is stored in the same transaction as the change.
 */
export async function executeCommand(command: AppCommand, options: { requestId?: string } = {}) {
  const owner = await ensureOwner();
  if (!CONSENT_EXEMPT_COMMANDS.has(command.type)) assertConsent(owner);
  const requestId = options.requestId ?? ("clientRequestId" in command ? command.clientRequestId : undefined);
  await getDb().transaction(async (tx) => {
    await tx.select().from(s.ownerSettings).where(eq(s.ownerSettings.id, owner.id)).for("update");
    if (requestId) {
      const claimed = await tx.insert(s.commandRequests).values({ ownerId: owner.id, clientRequestId: requestId }).onConflictDoNothing().returning({ id: s.commandRequests.id });
      if (!claimed.length) return;
    }
    await dispatch({ tx, owner }, command);
    if (CONVERTING_COMMANDS.has(command.type)) await assertBaseAmountsSafe(tx, owner.id);
  });
}
