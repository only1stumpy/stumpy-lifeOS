import type { CurrencyCode } from "./currencies";
export type ModuleKey = "today" | "nutrition" | "finance" | "gym";

export type MacroValues = {
  calories: number;
  proteinGrams: number;
  fatGrams: number;
  carbsGrams: number;
};

export type FoodLogEntry = MacroValues & {
  id: string;
  label: string;
  occurredAt: string;
  portionLabel: string;
  estimated: boolean;
};

export type MoneyAccount = {
  id: string;
  name: string;
  /** Currency code of the account, e.g. USD, EUR or a custom code such as PRB. */
  currency: CurrencyCode;
  balanceMinor: number;
  openingBalanceMinor: number;
  isDefault: boolean;
};

export type MoneyEntry = {
  id: string;
  accountId: string;
  label: string;
  occurredAt: string;
  amountMinor: number;
  currency: CurrencyCode;
  category: string;
  kind: "expense" | "income";
};

export type FinancePlan = {
  id: string;
  name: string;
  amountMinor: number;
};

export type FinanceDebt = {
  id: string;
  personName: string;
  direction: "i_owe" | "owed_to_me";
  originalAmountMinor: number;
  remainingAmountMinor: number;
  dueOn: string | null;
  note: string | null;
  createdAt: string;
};

export type ExerciseSet = {
  id: string;
  index: number;
  weightKg: number | null;
  repetitions: number | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  completed: boolean;
};

export type WorkoutExercise = {
  id: string;
  name: string;
  restSeconds: number;
  sets: ExerciseSet[];
  previousPerformance: string | null;
  progressionHint: string | null;
};

export type WorkoutDay = {
  id: string;
  name: string;
  exercises: WorkoutExercise[];
};

export type LifeOSSnapshot = {
  localDate: string;
  nutrition: {
    consumed: MacroValues;
    target: MacroValues | null;
    entries: FoodLogEntry[];
    bodyWeightKg: number | null;
    weightHistory: { date: string; weightKg: number }[];
  };
  finance: {
    /** Expenses of the selected day and month, converted to the owner's base currency. */
    spentTodayMinor: number;
    spentMonthMinor: number;
    accounts: MoneyAccount[];
    entries: MoneyEntry[];
    plans: FinancePlan[];
    debts: FinanceDebt[];
  };
  gym: {
    trainingDay: boolean;
    nextWorkout: WorkoutDay | null;
    lastWorkout: { name: string; completedAt: string; summary: string } | null;
    program: WorkoutDay[];
  };
};

export type LifeOSAction =
  | { type: "food.add" }
  | { type: "food.edit"; id: string }
  | { type: "food.delete"; id: string }
  | { type: "food.set-target" }
  | { type: "weight.add" }
  | { type: "finance.add" }
  | { type: "finance.edit"; id: string }
  | { type: "finance.delete"; id: string }
  | { type: "finance.plan.add" }
  | { type: "finance.plan.edit"; id: string }
  | { type: "finance.plan.delete"; id: string }
  | { type: "finance.plan.purchase"; id: string }
  | { type: "finance.debt.add" }
  | { type: "finance.debt.repay"; id: string }
  | { type: "finance.manage-accounts" }
  | { type: "finance.manage-recurring" }
  | { type: "gym.edit-program" }
  | { type: "gym.start-workout"; workoutId: string }
  | { type: "gym.open-exercise"; workoutId: string; exerciseId: string }
  | { type: "gym.complete-set"; workoutId: string; exerciseId: string; setId: string }
  | { type: "gym.add-exercise"; workoutId: string };
