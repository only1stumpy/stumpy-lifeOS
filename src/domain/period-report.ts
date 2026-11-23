import type { MacroValues } from "./types";
import { convertToBaseMinor, dateKey, sumMacros, weightStampToDate } from "./math";
import { monthStart } from "./notifications";
import { normalizeModules, resolveFeatures } from "./modules";

export type ReportPeriod = "day" | "week" | "month";
export type PeriodReport = {
  period: ReportPeriod;
  start: string;
  end: string;
  currency: string;
  nutrition?: { total: MacroValues; average: MacroValues; loggedDays: number; target: MacroValues | null; days: { date: string; calories: number | null }[] };
  weight?: { first: number | null; last: number | null; change: number | null; points: { date: string; weightKg: number }[] };
  finance?: { expenseMinor: number; incomeMinor: number; expenses: { name: string; amountMinor: number }[]; incomes: { name: string; amountMinor: number }[] };
  gym?: { workouts: number; sets: number; volumeKg: number };
};

export function periodBounds(period: ReportPeriod, start: string, today: string): { start: string; end: string } {
  const date = new Date(`${start}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== start || start > today
    || (period === "week" && date.getUTCDay() !== 1)
    || (period === "month" && monthStart(start) !== start)) throw new Error("Некорректный период сводки.");
  const last = new Date(date);
  if (period === "week") last.setUTCDate(last.getUTCDate() + 6);
  if (period === "month") last.setUTCMonth(last.getUTCMonth() + 1, 0);
  const end = last.toISOString().slice(0, 10);
  return { start, end: end < today ? end : today };
}

type Food = { occurredAt: Date; calories: string; proteinGrams: string; fatGrams: string; carbsGrams: string };
type Money = { occurredAt: Date; entryType: string; amount: string; currency: string; rateToBase: string | null; categoryId: string };
type Weight = { occurredAt: Date; weightKg: string };
type Session = { id: string; status: string; completedAt: Date | null };
type SetRow = { sessionExerciseId: string; isCompleted: boolean; completedAt: Date | null; weightKg: string | null; repetitions: number | null };

export function buildPeriodReport(input: {
  period: ReportPeriod; start: string; end: string; timeZone: string; baseCurrency: string;
  enabledModules: readonly string[]; disabledFeatures: readonly string[];
  foods: Food[]; money: Money[]; weights: Weight[];
  categories: { id: string; name: string }[];
  sessions: Session[]; sessionItems: { id: string; sessionId: string }[]; sets: SetRow[];
  target: MacroValues | null;
}): PeriodReport {
  const { start, end, timeZone } = input;
  const inRange = (date: string) => date >= start && date <= end;
  const inPeriod = (date: Date) => inRange(dateKey(date, timeZone));
  const modules = normalizeModules(input.enabledModules);
  const report: PeriodReport = { period: input.period, start, end, currency: input.baseCurrency };
  if (modules.includes("nutrition")) {
    const byDay = new Map<string, MacroValues>();
    for (const food of input.foods.filter((entry) => inPeriod(entry.occurredAt))) {
      const key = dateKey(food.occurredAt, timeZone);
      const macros = { calories: Number(food.calories), proteinGrams: Number(food.proteinGrams), fatGrams: Number(food.fatGrams), carbsGrams: Number(food.carbsGrams) };
      byDay.set(key, sumMacros([byDay.get(key) ?? { calories: 0, proteinGrams: 0, fatGrams: 0, carbsGrams: 0 }, macros]));
    }
    const total = sumMacros([...byDay.values()]);
    const loggedDays = byDay.size;
    const average = Object.fromEntries(Object.entries(total).map(([key, value]) => [key, loggedDays ? Math.round(value / loggedDays * 100) / 100 : 0])) as MacroValues;
    const days: { date: string; calories: number | null }[] = [];
    const date = new Date(`${start}T12:00:00Z`);
    while (date.toISOString().slice(0, 10) <= end) {
      const key = date.toISOString().slice(0, 10);
      days.push({ date: key, calories: byDay.get(key)?.calories ?? null });
      date.setUTCDate(date.getUTCDate() + 1);
    }
    report.nutrition = { total, average, loggedDays, target: input.target, days };
    if (resolveFeatures(modules, input.disabledFeatures).includes("nutrition.weight")) {
      const points = input.weights.map((row) => ({ date: weightStampToDate(row.occurredAt), weightKg: Number(row.weightKg) }))
        .filter((row) => inRange(row.date)).sort((a, b) => a.date.localeCompare(b.date));
      const first = points[0]?.weightKg ?? null;
      const last = points.at(-1)?.weightKg ?? null;
      report.weight = { first, last, change: first !== null && last !== null ? Math.round((last - first) * 10) / 10 : null, points };
    }
  }
  if (modules.includes("finance")) {
    const expense = new Map<string, number>();
    const income = new Map<string, number>();
    const names = new Map(input.categories.map((category) => [category.id, category.name]));
    for (const entry of input.money.filter((row) => inPeriod(row.occurredAt))) {
      const amount = convertToBaseMinor(Math.round(Number(entry.amount) * 100), entry.currency, input.baseCurrency, entry.rateToBase);
      const bucket = entry.entryType === "expense" ? expense : income;
      const name = names.get(entry.categoryId) ?? "Без категории";
      bucket.set(name, (bucket.get(name) ?? 0) + amount);
    }
    const rows = (bucket: Map<string, number>) => [...bucket].map(([name, amountMinor]) => ({ name, amountMinor })).sort((a, b) => b.amountMinor - a.amountMinor);
    const expenses = rows(expense), incomes = rows(income);
    report.finance = { expenseMinor: expenses.reduce((sum, row) => sum + row.amountMinor, 0), incomeMinor: incomes.reduce((sum, row) => sum + row.amountMinor, 0), expenses, incomes };
  }
  if (modules.includes("gym")) {
    const sessions = input.sessions.filter((row) => row.status === "completed" && row.completedAt && inPeriod(row.completedAt));
    const itemIds = new Set(input.sessionItems.map((row) => row.id));
    const sets = input.sets.filter((row) => row.isCompleted && row.completedAt && inPeriod(row.completedAt) && itemIds.has(row.sessionExerciseId));
    report.gym = { workouts: sessions.length, sets: sets.length, volumeKg: sets.reduce((sum, row) => sum + Number(row.weightKg ?? 0) * (row.repetitions ?? 0), 0) };
  }
  return report;
}
