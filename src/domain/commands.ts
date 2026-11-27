import { z } from "zod";
import { currencyCodeSchema } from "./currencies";
import { disabledFeaturesSchema, enabledModulesSchema } from "./modules";
import { notificationSettingsSchema, usageModeSchema } from "./notifications";
import { profileSchema } from "./nutrition";

const id = z.string().uuid();
const text = z.string().trim().min(1).max(300);
const timestamp = z.string().datetime({ offset: true });
const nutrient = z.number().finite().min(0).max(100000);
const minor = z.number().int().min(1).max(1_000_000_000_000);
export const macrosSchema = z.object({ calories: nutrient, proteinGrams: nutrient, fatGrams: nutrient, carbsGrams: nutrient });
export const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("settings.save"), timeZone: z.string().min(1).max(100), target: macrosSchema.nullable() }),
  z.object({ type: z.literal("food.save"), id: id.optional(), clientRequestId: id.optional(), label: text, portionLabel: text, occurredAt: timestamp, estimated: z.boolean().default(false), ...macrosSchema.shape }),
  z.object({ type: z.literal("food.delete"), id }),
  z.object({ type: z.literal("profile.save"), profile: profileSchema, target: macrosSchema }),
  z.object({ type: z.literal("profile.skip") }),
  z.object({ type: z.literal("notifications.save"), settings: notificationSettingsSchema }),
  z.object({ type: z.literal("personalization.save"), modules: enabledModulesSchema, disabledFeatures: disabledFeaturesSchema, settings: notificationSettingsSchema }),
  z.object({ type: z.literal("version.seen"), version: z.string().min(1).max(20) }),
  z.object({ type: z.literal("privacy.accept"), version: z.string().min(1).max(20), adultConfirmed: z.literal(true), healthVersion: z.string().min(1).max(20).optional() }),
  z.object({ type: z.literal("privacy.health.accept"), version: z.string().min(1).max(20) }),
  z.object({ type: z.literal("privacy.health.revoke") }),
  z.object({ type: z.literal("account.delete"), confirmation: z.literal("УДАЛИТЬ") }),
  z.object({ type: z.literal("modules.save"), modules: enabledModulesSchema, disabledFeatures: disabledFeaturesSchema.optional() }),
  z.object({
    type: z.literal("onboarding.complete"),
    modules: enabledModulesSchema,
    usage: usageModeSchema,
    /** IANA zone detected on the device during onboarding; absent keeps the stored one. */
    timeZone: z.string().min(1).max(100).optional(),
    profile: profileSchema.nullable(),
    target: macrosSchema.nullable(),
    account: z.object({
      currency: currencyCodeSchema,
      openingBalanceMinor: z.number().int().min(-1e12).max(1e12),
    }).nullable(),
  }),
  z.object({ type: z.literal("weight.save"), date: z.string().date(), weightKg: z.number().min(1).max(700) }),
  z.object({ type: z.literal("account.save"), id: id.optional(), name: text, currency: currencyCodeSchema, openingBalanceMinor: z.number().int().min(-1e12).max(1e12).default(0), isDefault: z.boolean().default(false) }),
  z.object({ type: z.literal("rate.save"), currency: currencyCodeSchema, rateToBase: z.string().regex(/^\d{1,10}(\.\d{1,10})?$/).refine((v) => Number(v) > 0), effectiveAt: timestamp.optional() }),
  z.object({ type: z.literal("base-currency.change"), currency: currencyCodeSchema, previousCurrency: currencyCodeSchema, rateToNew: z.string().regex(/^\d{1,10}(\.\d{1,10})?$/).refine((v) => Number(v) > 0) }),
  z.object({ type: z.literal("money.save"), id: id.optional(), clientRequestId: id.optional(), label: text, occurredAt: timestamp, amountMinor: minor, accountId: id, category: text, kind: z.enum(["expense", "income"]) }),
  z.object({ type: z.literal("money.delete"), id }),
  z.object({ type: z.literal("finance-plan.save"), id: id.optional(), name: text, amountMinor: minor }),
  z.object({ type: z.literal("finance-plan.delete"), id }),
  z.object({ type: z.literal("finance-plan.purchase"), id, label: text, actualAmountMinor: minor, occurredAt: timestamp, accountId: id, category: text }),
  z.object({ type: z.literal("debt.create"), clientRequestId: id.optional(), personName: text, direction: z.enum(["i_owe", "owed_to_me"]), amountMinor: minor, openedAs: z.enum(["transfer", "opening_balance"]), accountId: id.optional(), occurredAt: timestamp.optional(), dueOn: z.string().date().nullable(), note: z.string().trim().max(1000).nullable() }),
  z.object({ type: z.literal("debt.repayment.create"), clientRequestId: id.optional(), id, amountMinor: minor, accountId: id, occurredAt: timestamp }),
  z.object({ type: z.literal("debt.delete"), id }),
  z.object({ type: z.literal("debt.repayment.delete"), id }),
  z.object({ type: z.literal("recurring.save"), id: id.optional(), name: text, amountMinor: minor, accountId: id, category: text, frequency: z.enum(["weekly", "monthly", "yearly"]), nextDueAt: timestamp }),
  z.object({ type: z.literal("recurring.confirm"), id, dueOn: z.string().date().optional() }),
  z.object({ type: z.literal("day.save"), id: id.optional(), name: text, weekday: z.number().int().min(0).max(6).nullable().default(null) }),
  z.object({ type: z.literal("day.delete"), id: id }),
  z.object({ type: z.literal("exercise.update"), dayId: id, dayExerciseId: id, targetSets: z.number().int().min(1).max(30), targetRepetitions: z.number().int().min(1).max(1000), restSeconds: z.number().int().min(0).max(3600) }),
  z.object({ type: z.literal("exercise.remove"), dayId: id, dayExerciseId: id }),
  z.object({ type: z.literal("weight.delete"), date: z.string().date() }),
  z.object({ type: z.literal("day.move"), dayId: id, direction: z.enum(["up", "down"]) }),
  z.object({ type: z.literal("exercise.add"), dayId: id, name: text, targetSets: z.number().int().min(1).max(30), targetRepetitions: z.number().int().min(1).max(1000), restSeconds: z.number().int().min(0).max(3600).default(90), muscleGroup: z.string().trim().max(200).default(""), equipment: z.string().trim().max(200).default(""), instructions: z.string().max(5000).default("") }),
  z.object({ type: z.literal("exercise.replace"), dayId: id, dayExerciseId: id, name: text, muscleGroup: z.string().trim().max(200).default(""), equipment: z.string().trim().max(200).default(""), instructions: z.string().max(5000).default("") }),
  z.object({ type: z.literal("exercise.move"), dayId: id, dayExerciseId: id, direction: z.enum(["up", "down"]) }),
  z.object({ type: z.literal("session.start"), dayId: id }),
  z.object({ type: z.literal("set.save"), dayId: id, exerciseId: id, setIndex: z.number().int().min(1).max(100), weightKg: z.number().min(0).max(2000).nullable(), repetitions: z.number().int().min(1).max(10000).nullable(), durationSeconds: z.number().int().min(1).max(86400).nullable(), distanceMeters: z.number().gt(0).max(1e6).nullable() }).refine((set) => set.repetitions !== null || set.durationSeconds !== null || set.distanceMeters !== null, { message: "Укажи положительное значение повторений, времени или дистанции." }),
  z.object({ type: z.literal("session.finish"), id }),
  z.object({ type: z.literal("draft.confirm"), id }),
  z.object({ type: z.literal("draft.reject"), id }),
  z.object({ type: z.literal("draft.money-category.set"), id, category: text }),
  z.object({ type: z.literal("template.save"), foodEntryId: id, name: text }),
]);
export type AppCommand = z.infer<typeof commandSchema>;
