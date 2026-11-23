import { and, desc, eq, lte } from "drizzle-orm";
import * as schema from "@/db/schema";
import { getDb } from "@/db/client";
import { dateKey } from "@/domain/math";
import { buildPeriodReport, periodBounds, type ReportPeriod } from "@/domain/period-report";
import { ensureOwner } from "@/server/lifeos";
import { AppError } from "@/server/http";

export async function loadPeriodReport(period: ReportPeriod, start: string, now = new Date()) {
  const owner = await ensureOwner();
  let bounds: ReturnType<typeof periodBounds>;
  try {
    bounds = periodBounds(period, start, dateKey(now, owner.timezone));
  } catch {
    throw new AppError(400, "Некорректный период сводки.");
  }
  const db = getDb();
  const [foods, money, weights, categories, sessions, sessionItems, sets, targets] = await Promise.all([
    db.select().from(schema.nutritionEntries).where(eq(schema.nutritionEntries.ownerId, owner.id)),
    db.select().from(schema.financeEntries).where(eq(schema.financeEntries.ownerId, owner.id)),
    db.select().from(schema.weightEntries).where(eq(schema.weightEntries.ownerId, owner.id)),
    db.select().from(schema.financeCategories).where(eq(schema.financeCategories.ownerId, owner.id)),
    db.select().from(schema.workoutSessions).where(eq(schema.workoutSessions.ownerId, owner.id)),
    db.select().from(schema.workoutSessionExercises).where(eq(schema.workoutSessionExercises.ownerId, owner.id)),
    db.select().from(schema.workoutSets).where(eq(schema.workoutSets.ownerId, owner.id)),
    db.select().from(schema.nutritionTargets).where(and(eq(schema.nutritionTargets.ownerId, owner.id), lte(schema.nutritionTargets.effectiveFrom, bounds.end)))
      .orderBy(desc(schema.nutritionTargets.effectiveFrom)).limit(1),
  ]);
  const target = targets[0] ? {
    calories: Number(targets[0].calories), proteinGrams: Number(targets[0].proteinGrams),
    fatGrams: Number(targets[0].fatGrams), carbsGrams: Number(targets[0].carbsGrams),
  } : null;
  return buildPeriodReport({ period, ...bounds, timeZone: owner.timezone, baseCurrency: owner.baseCurrency ?? "USD",
    enabledModules: owner.enabledModules, disabledFeatures: owner.disabledFeatures,
    foods, money, weights, categories, sessions, sessionItems, sets, target });
}
