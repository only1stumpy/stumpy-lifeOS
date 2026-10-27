import type { LifeOSSnapshot } from "./types";
import type { MacroValues } from "./types";
export type AppReports = {
  nutritionDays: (MacroValues & { date: string; entryCount: number })[];
  expenseDays: { date: string; amountMinor: number }[];
  expenseCategories: { name: string; amountMinor: number }[];
  monthComparison: { currentMinor: number; previousMinor: number; previousPeriodEnd: string };
  repeatPurchases: { name: string; count: number; amountMinor: number }[];
  largestPurchases: { name: string; amountMinor: number; occurredAt: string }[];
  workoutHistory: { id: string; name: string; completedAt: string; completedSets: number; volumeKg: number }[];
  exerciseProgress: { id: string; name: string; points: { date: string; weightKg: number; repetitions: number | null }[] }[];
};
export type AppSnapshot = LifeOSSnapshot & {
  reports: AppReports;
  settings: { timeZone: string; usdToPrb: string | null; defaultAccountId: string | null };
  recurring: { id: string; name: string; amountMinor: number; accountId: string; currency: "PRB" | "USD"; category: string; frequency: "weekly" | "monthly" | "yearly"; nextDueAt: string }[];
  drafts: { id: string; description: string; occurredAt: string; food: { label: string; portionLabel: string; calories: number; proteinGrams: number; fatGrams: number; carbsGrams: number; estimated: boolean } | null; money: { label: string; amountMinor: number; currency: "PRB" | "USD"; kind: "expense" | "income"; category: string | null } | null }[];
  templates: { id: string; name: string }[];
  activeSession: { id: string; dayId: string; startedAt: string } | null;
};
