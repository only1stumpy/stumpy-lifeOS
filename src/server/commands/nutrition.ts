import { and, desc, eq } from "drizzle-orm";
import type { Transaction } from "@/db/client";
import * as s from "@/db/schema";
import { dateKey } from "@/domain/math";
import { birthDateForAge } from "@/domain/nutrition";
import type { NutritionProfile } from "@/domain/nutrition";
import type { MacroValues } from "@/domain/types";
import { AppError } from "../http";
import { macroNumbers, macroStrings } from "./shared";
import type { CommandHandlers, OwnerRow } from "./types";

export async function saveProfile(tx: Transaction, owner: OwnerRow, profile: NutritionProfile, target: MacroValues): Promise<void> {
  const today = dateKey(new Date(), owner.timezone);
  await tx.update(s.ownerSettings).set({ sex: profile.sex, dateOfBirth: birthDateForAge(profile.age, today), heightCm: String(profile.heightCm), activityLevel: profile.activityLevel, goalType: profile.goalType, profileOnboardingCompleted: true, updatedAt: new Date() }).where(eq(s.ownerSettings.id, owner.id));
  const [latestWeight] = await tx.select().from(s.weightEntries).where(eq(s.weightEntries.ownerId, owner.id)).orderBy(desc(s.weightEntries.occurredAt)).limit(1);
  if (!latestWeight || Number(latestWeight.weightKg) !== profile.weightKg) await saveDailyWeight(tx, owner.id, today, profile.weightKg);
  await tx.insert(s.nutritionTargets).values({ ownerId: owner.id, effectiveFrom: today, ...macroStrings(target) }).onConflictDoUpdate({ target: [s.nutritionTargets.ownerId, s.nutritionTargets.effectiveFrom], set: macroStrings(target) });
}

/** One weight measurement per local day: a repeated entry for the same date replaces the earlier one. */
export async function saveDailyWeight(tx: Transaction, ownerId: string, date: string, weightKg: number): Promise<void> {
  const occurredAt = new Date(date + "T12:00:00Z");
  const updated = await tx.update(s.weightEntries).set({ weightKg: String(weightKg) }).where(and(eq(s.weightEntries.ownerId, ownerId), eq(s.weightEntries.occurredAt, occurredAt))).returning({ id: s.weightEntries.id });
  if (!updated.length) await tx.insert(s.weightEntries).values({ ownerId, weightKg: String(weightKg), occurredAt });
}

export const nutritionHandlers = {
  "food.save": async ({ tx, owner }, command) => {
    const values = { ownerId: owner.id, name: command.label, portionLabel: command.portionLabel, occurredAt: new Date(command.occurredAt), estimated: command.estimated, ...macroStrings(command), source: "mini_app" };
    if (command.id) await tx.update(s.nutritionEntries).set({ ...values, updatedAt: new Date() }).where(and(eq(s.nutritionEntries.id, command.id), eq(s.nutritionEntries.ownerId, owner.id)));
    else await tx.insert(s.nutritionEntries).values(values);
  },
  "food.delete": async ({ tx, owner }, command) => {
    await tx.delete(s.nutritionEntries).where(and(eq(s.nutritionEntries.id, command.id), eq(s.nutritionEntries.ownerId, owner.id)));
  },
  "profile.save": async ({ tx, owner }, command) => {
    await saveProfile(tx, owner, command.profile, command.target);
  },
  "weight.save": async ({ tx, owner }, command) => {
    await saveDailyWeight(tx, owner.id, command.date, command.weightKg);
  },
  "weight.delete": async ({ tx, owner }, command) => {
    const removed = await tx.delete(s.weightEntries).where(and(eq(s.weightEntries.ownerId, owner.id), eq(s.weightEntries.occurredAt, new Date(command.date + "T12:00:00Z")))).returning({ id: s.weightEntries.id });
    if (!removed.length) throw new AppError(404, "Замер не найден.");
  },
  "template.save": async ({ tx, owner }, command) => {
    const [entry] = await tx.select().from(s.nutritionEntries).where(and(eq(s.nutritionEntries.id, command.foodEntryId), eq(s.nutritionEntries.ownerId, owner.id)));
    if (!entry) throw new AppError(404, "Запись еды не найдена.");
    const values = { ownerId: owner.id, name: command.name, portionLabel: entry.portionLabel, ...macroStrings(macroNumbers(entry)), composition: entry.composition };
    await tx.insert(s.foodTemplates).values(values).onConflictDoUpdate({ target: [s.foodTemplates.ownerId, s.foodTemplates.name], set: values });
  },
} satisfies Partial<CommandHandlers>;
