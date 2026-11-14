import { z } from "zod";
import type { MacroValues } from "./types";

export const ACTIVITY_LEVELS = {
  minimal: { multiplier: 1.2, label: "Минимальная, без спорта" },
  light: { multiplier: 1.375, label: "Лёгкая, 1–2 тренировки в неделю" },
  moderate: { multiplier: 1.55, label: "Средняя, 3–4 тренировки в неделю" },
  high: { multiplier: 1.725, label: "Высокая, 5+ тренировок или физ. труд" },
} as const;
export type ActivityLevel = keyof typeof ACTIVITY_LEVELS;

/** Calorie factor and protein per kg of body weight for each goal. */
export const GOALS = {
  lose_weight: { calorieFactor: 0.85, proteinPerKg: 2, label: "Похудеть" },
  maintain: { calorieFactor: 1, proteinPerKg: 1.6, label: "Держать вес" },
  gain_mass: { calorieFactor: 1.1, proteinPerKg: 1.6, label: "Набрать массу" },
} as const;
export type GoalType = keyof typeof GOALS;

export const profileSchema = z.object({
  sex: z.enum(["male", "female"]),
  age: z.number().int().min(16).max(90),
  heightCm: z.number().min(100).max(250),
  weightKg: z.number().min(30).max(350),
  activityLevel: z.enum(Object.keys(ACTIVITY_LEVELS) as [ActivityLevel, ...ActivityLevel[]]),
  goalType: z.enum(Object.keys(GOALS) as [GoalType, ...GoalType[]]),
});
export type NutritionProfile = z.infer<typeof profileSchema>;

/** Editable starting estimate: Mifflin-St Jeor resting energy × activity × goal factor, rounded to 50 kcal. */
export function suggestTargets(raw: z.input<typeof profileSchema>): MacroValues {
  const p = profileSchema.parse(raw);
  const goal = GOALS[p.goalType];
  const resting = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + (p.sex === "male" ? 5 : -161);
  const calories = Math.round(resting * ACTIVITY_LEVELS[p.activityLevel].multiplier * goal.calorieFactor / 50) * 50;
  const proteinGrams = Math.round(goal.proteinPerKg * p.weightKg);
  const fatGrams = Math.round(0.8 * p.weightKg);
  const carbsGrams = Math.max(0, Math.round((calories - proteinGrams * 4 - fatGrams * 9) / 4));
  return { calories, proteinGrams, fatGrams, carbsGrams };
}

/** Full years between an ISO birth date and an ISO local date. */
export function ageOn(birthDate: string, localDate: string): number {
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [y, m, d] = localDate.split("-").map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

/** Approximate birth date for a stated age: the same calendar day `age` years ago, so the age grows by itself. */
export function birthDateForAge(age: number, localDate: string): string {
  const [y, m, d] = localDate.split("-");
  return `${String(Number(y) - age).padStart(4, "0")}-${m}-${m === "02" && d === "29" ? "28" : d}`;
}

export const MIN_WEEKLY_WEIGH_INS = 3;

/** Average body weight over the 7 local days ending on `today` (inclusive), rounded to 0.1 kg. */
export function weeklyAverageWeight(weights: { date: string; weightKg: number }[], today: string): { weighIns: number; averageKg: number | null } {
  const start = new Date(today + "T12:00:00Z");
  start.setUTCDate(start.getUTCDate() - 6);
  const from = start.toISOString().slice(0, 10);
  const recent = weights.filter((entry) => entry.date >= from && entry.date <= today);
  if (!recent.length) return { weighIns: 0, averageKg: null };
  const average = recent.reduce((sum, entry) => sum + entry.weightKg, 0) / recent.length;
  return { weighIns: recent.length, averageKg: Math.round(average * 10) / 10 };
}

/**
 * Target recalculated from the stated profile and the weekly average weight.
 * Null when the profile is incomplete or the result matches the current target.
 */
export function targetFromAverage(profile: Partial<Omit<NutritionProfile, "weightKg">>, averageKg: number, current: MacroValues | null): MacroValues | null {
  const parsed = profileSchema.safeParse({ ...profile, weightKg: averageKg });
  if (!parsed.success) return null;
  const next = suggestTargets(parsed.data);
  if (current && Math.round(current.calories) === next.calories && Math.abs(current.proteinGrams - next.proteinGrams) < 5) return null;
  return next;
}
