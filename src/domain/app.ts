import type { CurrencyCode } from "./currencies";
import type { LifeOSSnapshot, MacroValues } from "./types";
import type { NotificationSettings } from "./notifications";
import type { LifeFeature, LifeModule } from "./modules";
import type { NutritionProfile } from "./nutrition";
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
  settings: { timeZone: string; baseCurrency: CurrencyCode; rates: Record<CurrencyCode, string>; defaultAccountId: string | null; aiOnboardingCompleted: boolean; profileOnboardingCompleted: boolean; profile: Partial<Omit<NutritionProfile, "weightKg">>; notificationsConfigured: boolean; notifications: NotificationSettings; lastSeenVersion: string | null; privacyAcceptedVersion: string | null; healthConsentVersion: string | null; enabledModules: LifeModule[]; modulesConfigured: boolean; enabledFeatures: LifeFeature[]; disabledFeatures: LifeFeature[] };
  recurring: { id: string; name: string; amountMinor: number; accountId: string; currency: CurrencyCode; category: string; frequency: "weekly" | "monthly" | "yearly"; nextDueAt: string }[];
  drafts: { id: string; description: string; occurredAt: string; plan: { name: string; amountMinor: number } | null; food: { label: string; portionLabel: string; calories: number; proteinGrams: number; fatGrams: number; carbsGrams: number; estimated: boolean } | null; money: { label: string; amountMinor: number; currency: CurrencyCode; kind: "expense" | "income"; category: string | null } | null; debt: { operation: "create" | "repayment"; personName: string; direction: "i_owe" | "owed_to_me"; amountMinor: number; openedAs: "transfer" | "opening_balance" | null; debtId: string | null; dueOn: string | null; note: string | null; remainingAmountMinor: number | null } | null }[];
  templates: { id: string; name: string; portionLabel: string; calories: number; proteinGrams: number; fatGrams: number; carbsGrams: number }[];
  activeSession: { id: string; dayId: string; startedAt: string } | null;
};
