import { z } from "zod";
import type { MacroValues } from "./types";
export const targetParametersSchema = z.object({
  age: z.number().int().min(19).max(78),
  heightCm: z.number().min(100).max(250),
  weightKg: z.number().min(30).max(350),
  sex: z.enum(["male", "female"]),
  activityMultiplier: z.number().min(1.2).max(1.9),
});
/** Editable starting estimate: Mifflin-St Jeor, chosen activity factor, 10% surplus. */
export function suggestTargets(raw: z.input<typeof targetParametersSchema>): MacroValues {
  const p = targetParametersSchema.parse(raw);
  const resting = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + (p.sex === "male" ? 5 : -161);
  const calories = Math.round(resting * p.activityMultiplier * 1.1 / 50) * 50;
  const proteinGrams = Math.round(1.6 * p.weightKg);
  const fatGrams = Math.round(0.8 * p.weightKg);
  const carbsGrams = Math.max(0, Math.round((calories - proteinGrams * 4 - fatGrams * 9) / 4));
  return { calories, proteinGrams, fatGrams, carbsGrams };
}

