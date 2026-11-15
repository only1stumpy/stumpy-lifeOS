import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { createCommandDb, newTelegramId, ownerOf, rejectsWith, run, T, type CommandDb } from "./helpers/command-db";

const macros = { calories: 250, proteinGrams: 20, fatGrams: 10, carbsGrams: 15 };

describe("команды питания и веса", () => {
  let ctx: Awaited<ReturnType<typeof createCommandDb>>;
  let db: CommandDb;
  before(async () => { ctx = await createCommandDb(); db = ctx.db; });
  after(async () => { await ctx.client.close(); });
  const foods = (ownerId: string) => db.select().from(s.nutritionEntries).where(eq(s.nutritionEntries.ownerId, ownerId));

  test("food.save создаёт запись, повтор с id правит её, food.delete удаляет", async () => {
    const tg = newTelegramId();
    const owner = await ownerOf(db, tg);
    await run(tg, { type: "food.save", label: "Омлет", portionLabel: "1 порция", occurredAt: T, ...macros });
    const [created] = await foods(owner.id);
    assert.equal(created.name, "Омлет");
    assert.equal(Number(created.calories), 250);
    assert.equal(created.estimated, false);

    await run(tg, { type: "food.save", id: created.id, label: "Омлет с сыром", portionLabel: "2 порции", occurredAt: T, estimated: true, ...macros, calories: 400 });
    const rows = await foods(owner.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, "Омлет с сыром");
    assert.equal(Number(rows[0].calories), 400);
    assert.equal(rows[0].estimated, true);

    await run(tg, { type: "food.delete", id: created.id });
    assert.equal((await foods(owner.id)).length, 0);
  });

  test("weight.save за ту же дату обновляет замер, weight.delete удаляет, повторное удаление даёт 404", async () => {
    const tg = newTelegramId();
    const owner = await ownerOf(db, tg);
    await run(tg, { type: "weight.save", date: "2026-03-10", weightKg: 80.5 });
    await run(tg, { type: "weight.save", date: "2026-03-10", weightKg: 79.9 });
    await run(tg, { type: "weight.save", date: "2026-03-11", weightKg: 79.5 });
    const rows = await db.select().from(s.weightEntries).where(eq(s.weightEntries.ownerId, owner.id));
    assert.deepEqual(rows.map((r) => Number(r.weightKg)).sort(), [79.5, 79.9]);
    await run(tg, { type: "weight.delete", date: "2026-03-10" });
    assert.equal((await db.select().from(s.weightEntries).where(eq(s.weightEntries.ownerId, owner.id))).length, 1);
    await rejectsWith(run(tg, { type: "weight.delete", date: "2026-03-10" }), 404);
  });

  test("template.save копирует запись еды, повтор с тем же именем обновляет шаблон, чужая запись даёт 404", async () => {
    const tg = newTelegramId();
    const owner = await ownerOf(db, tg);
    await run(tg, { type: "food.save", label: "Гречка", portionLabel: "200 г", occurredAt: T, ...macros });
    const [entry] = await foods(owner.id);
    await run(tg, { type: "template.save", foodEntryId: entry.id, name: "Обычная гречка" });
    await run(tg, { type: "food.save", id: entry.id, label: "Гречка", portionLabel: "300 г", occurredAt: T, ...macros, calories: 375 });
    await run(tg, { type: "template.save", foodEntryId: entry.id, name: "Обычная гречка" });
    const templates = await db.select().from(s.foodTemplates).where(eq(s.foodTemplates.ownerId, owner.id));
    assert.equal(templates.length, 1);
    assert.equal(templates[0].portionLabel, "300 г");
    assert.equal(Number(templates[0].calories), 375);

    const other = newTelegramId();
    await ownerOf(db, other);
    await rejectsWith(run(other, { type: "template.save", foodEntryId: entry.id, name: "Украл" }), 404);
  });

  test("схема отклоняет еду с отрицательными КБЖУ и неизвестную команду", async () => {
    const tg = newTelegramId();
    await assert.rejects(run(tg, { type: "food.save", label: "X", portionLabel: "X", occurredAt: T, ...macros, calories: -1 }));
    await assert.rejects(run(tg, { type: "food.explode", id: "x" }));
    await assert.rejects(run(tg, { type: "weight.save", date: "2026-03-10", weightKg: 0 }));
  });
});

describe("команды зала", () => {
  let ctx: Awaited<ReturnType<typeof createCommandDb>>;
  let db: CommandDb;
  before(async () => { ctx = await createCommandDb(); db = ctx.db; });
  after(async () => { await ctx.client.close(); });

  const addExercise = (tg: string, dayId: string, name = "Жим") => run(tg, { type: "exercise.add", dayId, name, targetSets: 3, targetRepetitions: 10 });
  async function setupDay(tg: string) {
    const owner = await ownerOf(db, tg);
    await run(tg, { type: "day.save", name: "Грудь", weekday: 1 });
    const [day] = await db.select().from(s.workoutDays).where(eq(s.workoutDays.ownerId, owner.id));
    return { owner, day };
  }
  const dayItems = (dayId: string) => db.select().from(s.workoutDayExercises).where(eq(s.workoutDayExercises.workoutDayId, dayId)).orderBy(s.workoutDayExercises.position);

  test("day.save создаёт и переименовывает день, day.delete архивирует, повторное удаление даёт 404", async () => {
    const tg = newTelegramId();
    const { owner, day } = await setupDay(tg);
    assert.equal(day.position, 0);
    await run(tg, { type: "day.save", id: day.id, name: "Грудь и плечи", weekday: null });
    const [renamed] = await db.select().from(s.workoutDays).where(eq(s.workoutDays.id, day.id));
    assert.equal(renamed.name, "Грудь и плечи");
    assert.equal(renamed.weekday, null);
    await run(tg, { type: "day.delete", id: day.id });
    const rows = await db.select().from(s.workoutDays).where(eq(s.workoutDays.ownerId, owner.id));
    assert.equal(rows.length, 1, "строка остаётся, день только архивируется");
    assert.equal(rows[0].isArchived, true);
    await rejectsWith(run(tg, { type: "day.delete", id: day.id }), 404);
  });

  test("exercise.add, update, move, remove: порядок упражнений пересчитывается", async () => {
    const tg = newTelegramId();
    const { day } = await setupDay(tg);
    await addExercise(tg, day.id, "Жим");
    await addExercise(tg, day.id, "Разводка");
    await addExercise(tg, day.id, "Отжимания");
    let items = await dayItems(day.id);
    assert.deepEqual(items.map((i) => i.position), [0, 1, 2]);

    await run(tg, { type: "exercise.update", dayId: day.id, dayExerciseId: items[0].id, targetSets: 5, targetRepetitions: 8, restSeconds: 120 });
    items = await dayItems(day.id);
    assert.equal(items[0].plannedSets, 5);
    assert.equal(items[0].targetRepsMin, 8);
    assert.equal(items[0].restSeconds, 120);

    await run(tg, { type: "exercise.move", dayId: day.id, dayExerciseId: items[2].id, direction: "up" });
    items = await dayItems(day.id);
    const names = await db.select().from(s.exercises);
    const nameOf = (id: string) => names.find((n) => n.id === id)!.name;
    assert.deepEqual(items.map((i) => nameOf(i.exerciseId)), ["Жим", "Отжимания", "Разводка"]);

    await run(tg, { type: "exercise.remove", dayId: day.id, dayExerciseId: items[0].id });
    items = await dayItems(day.id);
    assert.deepEqual(items.map((i) => i.position), [0, 1]);
    await rejectsWith(run(tg, { type: "exercise.update", dayId: day.id, dayExerciseId: crypto.randomUUID(), targetSets: 1, targetRepetitions: 1, restSeconds: 0 }), 404);
  });

  test("удаление упражнения с историей сессии не падает и сохраняет подходы", async () => {
    const tg = newTelegramId();
    const { owner, day } = await setupDay(tg);
    await addExercise(tg, day.id);
    const [item] = await dayItems(day.id);
    await run(tg, { type: "set.save", dayId: day.id, exerciseId: item.id, setIndex: 1, weightKg: 60, repetitions: 10, durationSeconds: null, distanceMeters: null });
    const [session] = await db.select().from(s.workoutSessions).where(eq(s.workoutSessions.ownerId, owner.id));
    await run(tg, { type: "session.finish", id: session.id });

    await run(tg, { type: "exercise.remove", dayId: day.id, dayExerciseId: item.id });
    assert.equal((await dayItems(day.id)).length, 0);
    const [sessionItem] = await db.select().from(s.workoutSessionExercises).where(eq(s.workoutSessionExercises.ownerId, owner.id));
    assert.equal(sessionItem.workoutDayExerciseId, null);
    assert.equal(sessionItem.exerciseName, "Жим");
    assert.equal((await db.select().from(s.workoutSets).where(eq(s.workoutSets.ownerId, owner.id))).length, 1);
  });

  test("session.start, set.save, повтор set.save обновляет подход, session.finish завершает тренировку", async () => {
    const tg = newTelegramId();
    const { owner, day } = await setupDay(tg);
    await addExercise(tg, day.id);
    const [item] = await dayItems(day.id);
    await run(tg, { type: "session.start", dayId: day.id });
    await run(tg, { type: "session.start", dayId: day.id });
    let sessions = await db.select().from(s.workoutSessions).where(eq(s.workoutSessions.ownerId, owner.id));
    assert.equal(sessions.length, 1, "повторный старт не плодит вторую активную сессию");
    assert.equal(sessions[0].status, "active");

    const set = { type: "set.save", dayId: day.id, exerciseId: item.id, setIndex: 1, weightKg: 50, repetitions: 10, durationSeconds: null, distanceMeters: null };
    await run(tg, set);
    await run(tg, { ...set, weightKg: 55, repetitions: 8 });
    await run(tg, { ...set, setIndex: 2 });
    const sets = await db.select().from(s.workoutSets).where(eq(s.workoutSets.ownerId, owner.id)).orderBy(s.workoutSets.setNumber);
    assert.equal(sets.length, 2);
    assert.equal(Number(sets[0].weightKg), 55);
    assert.equal(sets[0].repetitions, 8);

    await run(tg, { type: "session.finish", id: sessions[0].id });
    sessions = await db.select().from(s.workoutSessions).where(eq(s.workoutSessions.ownerId, owner.id));
    assert.equal(sessions[0].status, "completed");
    assert.ok(sessions[0].completedAt);
  });

  test("нельзя начать другой день при активной тренировке; подход без значений не проходит схему", async () => {
    const tg = newTelegramId();
    const { day } = await setupDay(tg);
    await run(tg, { type: "day.save", name: "Спина", weekday: 3 });
    const days = await db.select().from(s.workoutDays);
    const other = days.find((d) => d.name === "Спина" && d.ownerId === day.ownerId)!;
    await run(tg, { type: "session.start", dayId: day.id });
    await rejectsWith(run(tg, { type: "session.start", dayId: other.id }), 409);
    await assert.rejects(run(tg, { type: "set.save", dayId: day.id, exerciseId: crypto.randomUUID(), setIndex: 1, weightKg: 10, repetitions: null, durationSeconds: null, distanceMeters: null }));
  });
});
