import { and, eq } from "drizzle-orm";
import type { Transaction } from "@/db/client";
import * as s from "@/db/schema";
import { AppError } from "../http";
import type { CommandHandlers } from "./types";

async function startSession(tx: Transaction, ownerId: string, dayId: string) {
  const [day] = await tx.select().from(s.workoutDays).where(and(eq(s.workoutDays.id, dayId), eq(s.workoutDays.ownerId, ownerId)));
  if (!day) throw new AppError(404, "Тренировочный день не найден.");
  const [active] = await tx.select().from(s.workoutSessions).where(and(eq(s.workoutSessions.ownerId, ownerId), eq(s.workoutSessions.status, "active")));
  if (active) {
    if (active.workoutDayId !== dayId) throw new AppError(409, "Сначала завершите текущую тренировку.");
    return active;
  }
  const [session] = await tx.insert(s.workoutSessions).values({ ownerId, workoutDayId: dayId, name: day.name }).returning();
  const items = await tx.select().from(s.workoutDayExercises).where(eq(s.workoutDayExercises.workoutDayId, dayId));
  for (const item of items) {
    const [exercise] = await tx.select().from(s.exercises).where(eq(s.exercises.id, item.exerciseId));
    await tx.insert(s.workoutSessionExercises).values({ ownerId, sessionId: session.id, workoutDayExerciseId: item.id, exerciseId: item.exerciseId, exerciseName: exercise.name, position: item.position });
  }
  return session;
}

export const gymHandlers = {
  "day.save": async ({ tx, owner }, command) => {
    if (command.id) await tx.update(s.workoutDays).set({ name: command.name, weekday: command.weekday }).where(and(eq(s.workoutDays.id, command.id), eq(s.workoutDays.ownerId, owner.id)));
    else { const days = await tx.select().from(s.workoutDays).where(eq(s.workoutDays.ownerId, owner.id)); await tx.insert(s.workoutDays).values({ ownerId: owner.id, name: command.name, weekday: command.weekday, position: days.length }); }
  },
  "day.delete": async ({ tx, owner }, command) => {
    const archived = await tx.update(s.workoutDays).set({ isArchived: true }).where(and(eq(s.workoutDays.id, command.id), eq(s.workoutDays.ownerId, owner.id), eq(s.workoutDays.isArchived, false))).returning({ id: s.workoutDays.id });
    if (!archived.length) throw new AppError(404, "Тренировочный день не найден.");
  },
  "day.move": async ({ tx, owner }, command) => {
    const allDays = await tx.select().from(s.workoutDays)
      .where(eq(s.workoutDays.ownerId, owner.id))
      .orderBy(s.workoutDays.position).for("update");
    const days = allDays.filter((day) => !day.isArchived);
    const index = days.findIndex((day) => day.id === command.dayId);
    if (index < 0) throw new AppError(404, "Тренировочный день не найден.");
    const neighbor = days[index + (command.direction === "up" ? -1 : 1)];
    if (!neighbor) return;
    const temporaryPosition = Math.max(...allDays.map((day) => day.position)) + 1;
    if (temporaryPosition > 32767) throw new AppError(409, "Не удалось изменить порядок тренировочных дней.");
    const day = days[index];
    await tx.update(s.workoutDays).set({ position: temporaryPosition }).where(and(eq(s.workoutDays.id, day.id), eq(s.workoutDays.ownerId, owner.id)));
    await tx.update(s.workoutDays).set({ position: day.position }).where(and(eq(s.workoutDays.id, neighbor.id), eq(s.workoutDays.ownerId, owner.id)));
    await tx.update(s.workoutDays).set({ position: neighbor.position }).where(and(eq(s.workoutDays.id, day.id), eq(s.workoutDays.ownerId, owner.id)));
  },
  "exercise.add": async ({ tx, owner }, command) => {
    const [day] = await tx.select().from(s.workoutDays).where(and(eq(s.workoutDays.id, command.dayId), eq(s.workoutDays.ownerId, owner.id)));
    if (!day) throw new AppError(404, "День не найден.");
    await tx.insert(s.exercises).values({ ownerId: owner.id, name: command.name, muscleGroup: command.muscleGroup || null, equipment: command.equipment || null, instructions: command.instructions }).onConflictDoNothing();
    const [exercise] = await tx.select().from(s.exercises).where(and(eq(s.exercises.ownerId, owner.id), eq(s.exercises.name, command.name)));
    const items = await tx.select().from(s.workoutDayExercises).where(eq(s.workoutDayExercises.workoutDayId, day.id));
    const [dayExercise] = await tx.insert(s.workoutDayExercises).values({ ownerId: owner.id, workoutDayId: day.id, exerciseId: exercise.id, position: items.length, plannedSets: command.targetSets, targetRepsMin: command.targetRepetitions, targetRepsMax: command.targetRepetitions, restSeconds: command.restSeconds }).returning({ id: s.workoutDayExercises.id });
    // An exercise added during an active workout of this day joins that session, otherwise its sets would be rejected.
    const [active] = await tx.select().from(s.workoutSessions).where(and(eq(s.workoutSessions.ownerId, owner.id), eq(s.workoutSessions.workoutDayId, day.id), eq(s.workoutSessions.status, "active")));
    if (active) await tx.insert(s.workoutSessionExercises).values({ ownerId: owner.id, sessionId: active.id, workoutDayExerciseId: dayExercise.id, exerciseId: exercise.id, exerciseName: exercise.name, position: items.length });
  },
  "exercise.update": async ({ tx, owner }, command) => {
    const updated = await tx.update(s.workoutDayExercises).set({ plannedSets: command.targetSets, targetRepsMin: command.targetRepetitions, targetRepsMax: command.targetRepetitions, restSeconds: command.restSeconds })
      .where(and(eq(s.workoutDayExercises.id, command.dayExerciseId), eq(s.workoutDayExercises.workoutDayId, command.dayId), eq(s.workoutDayExercises.ownerId, owner.id))).returning({ id: s.workoutDayExercises.id });
    if (!updated.length) throw new AppError(404, "Упражнение в программе не найдено.");
  },
  "exercise.remove": async ({ tx, owner }, command) => {
    const items = await tx.select().from(s.workoutDayExercises)
      .where(and(eq(s.workoutDayExercises.ownerId, owner.id), eq(s.workoutDayExercises.workoutDayId, command.dayId)))
      .orderBy(s.workoutDayExercises.position).for("update");
    if (!items.some((item) => item.id === command.dayExerciseId)) throw new AppError(404, "Упражнение в программе не найдено.");
    await tx.update(s.workoutSessionExercises).set({ workoutDayExerciseId: null }).where(and(eq(s.workoutSessionExercises.workoutDayExerciseId, command.dayExerciseId), eq(s.workoutSessionExercises.ownerId, owner.id)));
    await tx.delete(s.workoutDayExercises).where(and(eq(s.workoutDayExercises.id, command.dayExerciseId), eq(s.workoutDayExercises.ownerId, owner.id)));
    const rest = items.filter((item) => item.id !== command.dayExerciseId);
    for (let i = 0; i < rest.length; i++) if (rest[i].position !== i) await tx.update(s.workoutDayExercises).set({ position: i }).where(and(eq(s.workoutDayExercises.id, rest[i].id), eq(s.workoutDayExercises.ownerId, owner.id)));
  },
  "exercise.replace": async ({ tx, owner }, command) => {
    const [item] = await tx.select().from(s.workoutDayExercises)
      .where(and(eq(s.workoutDayExercises.id, command.dayExerciseId), eq(s.workoutDayExercises.workoutDayId, command.dayId), eq(s.workoutDayExercises.ownerId, owner.id)))
      .for("update");
    if (!item) throw new AppError(404, "Упражнение в программе не найдено.");
    await tx.insert(s.exercises).values({ ownerId: owner.id, name: command.name, muscleGroup: command.muscleGroup || null, equipment: command.equipment || null, instructions: command.instructions }).onConflictDoNothing();
    const [replacement] = await tx.select().from(s.exercises).where(and(eq(s.exercises.ownerId, owner.id), eq(s.exercises.name, command.name)));
    if (!replacement) throw new AppError(500, "Не удалось сохранить упражнение.");
    await tx.update(s.workoutDayExercises).set({ exerciseId: replacement.id })
      .where(and(eq(s.workoutDayExercises.id, item.id), eq(s.workoutDayExercises.workoutDayId, command.dayId), eq(s.workoutDayExercises.ownerId, owner.id)));
  },
  "exercise.move": async ({ tx, owner }, command) => {
    const items = await tx.select().from(s.workoutDayExercises)
      .where(and(eq(s.workoutDayExercises.ownerId, owner.id), eq(s.workoutDayExercises.workoutDayId, command.dayId)))
      .orderBy(s.workoutDayExercises.position).for("update");
    const index = items.findIndex((item) => item.id === command.dayExerciseId);
    if (index < 0) throw new AppError(404, "Упражнение в программе не найдено.");
    const neighbor = items[index + (command.direction === "up" ? -1 : 1)];
    if (!neighbor) return;
    const temporaryPosition = Math.max(...items.map((item) => item.position)) + 1;
    if (temporaryPosition > 32767) throw new AppError(409, "Не удалось изменить порядок упражнений.");
    const item = items[index];
    await tx.update(s.workoutDayExercises).set({ position: temporaryPosition }).where(and(eq(s.workoutDayExercises.id, item.id), eq(s.workoutDayExercises.ownerId, owner.id)));
    await tx.update(s.workoutDayExercises).set({ position: item.position }).where(and(eq(s.workoutDayExercises.id, neighbor.id), eq(s.workoutDayExercises.ownerId, owner.id)));
    await tx.update(s.workoutDayExercises).set({ position: neighbor.position }).where(and(eq(s.workoutDayExercises.id, item.id), eq(s.workoutDayExercises.ownerId, owner.id)));
  },
  "session.start": async ({ tx, owner }, command) => {
    await startSession(tx, owner.id, command.dayId);
  },
  "set.save": async ({ tx, owner }, command) => {
    if (![command.repetitions, command.durationSeconds, command.distanceMeters].some((value) => value !== null && value > 0)) throw new AppError(400, "Укажите положительное значение повторений, времени или дистанции.");
    const session = await startSession(tx, owner.id, command.dayId);
    const [item] = await tx.select().from(s.workoutSessionExercises).where(and(eq(s.workoutSessionExercises.sessionId, session.id), eq(s.workoutSessionExercises.workoutDayExerciseId, command.exerciseId)));
    if (!item) throw new AppError(404, "Упражнение не найдено в текущей тренировке.");
    const values = { ownerId: owner.id, sessionExerciseId: item.id, setNumber: command.setIndex, weightKg: command.weightKg === null ? null : String(command.weightKg), repetitions: command.repetitions, durationSeconds: command.durationSeconds, distanceMeters: command.distanceMeters === null ? null : String(command.distanceMeters), isCompleted: true, completedAt: new Date() };
    await tx.insert(s.workoutSets).values(values).onConflictDoUpdate({ target: [s.workoutSets.sessionExerciseId, s.workoutSets.setNumber], set: values });
  },
  "session.finish": async ({ tx, owner }, command) => {
    await tx.update(s.workoutSessions).set({ status: "completed", completedAt: new Date() }).where(and(eq(s.workoutSessions.id, command.id), eq(s.workoutSessions.ownerId, owner.id), eq(s.workoutSessions.status, "active")));
  },
} satisfies Partial<CommandHandlers>;
