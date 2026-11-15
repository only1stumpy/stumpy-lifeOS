import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { createCommandDb, newTelegramId, ownerOf, rejectsWith, run, snapshotOf, uuid, T, type CommandDb } from "./helpers/command-db";

describe("изоляция владельцев на уровне команд", () => {
  let ctx: Awaited<ReturnType<typeof createCommandDb>>;
  let db: CommandDb;
  before(async () => { ctx = await createCommandDb(); db = ctx.db; });
  after(async () => { await ctx.client.close(); });

  /** Владелец A с едой, счётом, операцией, долгом, планом и днём зала. */
  async function seedOwner(tg: string, tag: string) {
    const owner = await ownerOf(db, tg);
    await run(tg, { type: "food.save", label: `Еда-${tag}`, portionLabel: "1", occurredAt: T, calories: 100, proteinGrams: 1, fatGrams: 1, carbsGrams: 1 });
    await run(tg, { type: "weight.save", date: "2026-03-10", weightKg: 70 });
    await run(tg, { type: "account.save", name: `Счёт-${tag}`, currency: "PRB", openingBalanceMinor: 5000, isDefault: true });
    const [acc] = await db.select().from(s.financeAccounts).where(eq(s.financeAccounts.ownerId, owner.id));
    await run(tg, { type: "money.save", label: `Трата-${tag}`, occurredAt: T, amountMinor: 100, accountId: acc.id, category: "Еда", kind: "expense" });
    await run(tg, { type: "debt.create", personName: `Должник-${tag}`, direction: "owed_to_me", amountMinor: 1000, openedAs: "opening_balance", dueOn: null, note: null });
    await run(tg, { type: "finance-plan.save", name: `План-${tag}`, amountMinor: 9000 });
    await run(tg, { type: "day.save", name: `День-${tag}`, weekday: 2 });
    const [day] = await db.select().from(s.workoutDays).where(eq(s.workoutDays.ownerId, owner.id));
    await run(tg, { type: "exercise.add", dayId: day.id, name: `Упр-${tag}`, targetSets: 3, targetRepetitions: 10 });
    const [item] = await db.select().from(s.workoutDayExercises).where(eq(s.workoutDayExercises.ownerId, owner.id));
    const [food] = await db.select().from(s.nutritionEntries).where(eq(s.nutritionEntries.ownerId, owner.id));
    const [entry] = await db.select().from(s.financeEntries).where(eq(s.financeEntries.ownerId, owner.id));
    const [debt] = await db.select().from(s.financeDebts).where(eq(s.financeDebts.ownerId, owner.id));
    const [plan] = await db.select().from(s.financePlans).where(eq(s.financePlans.ownerId, owner.id));
    return { owner, acc, day, item, food, entry, debt, plan };
  }

  async function counts(ownerId: string) {
    const count = async (table: typeof s.nutritionEntries | typeof s.weightEntries | typeof s.financeAccounts | typeof s.financeEntries | typeof s.financeDebts | typeof s.financePlans | typeof s.workoutDays | typeof s.workoutDayExercises) => (await db.select().from(table).where(eq(table.ownerId, ownerId))).length;
    return {
      food: await count(s.nutritionEntries), weight: await count(s.weightEntries), accounts: await count(s.financeAccounts),
      entries: await count(s.financeEntries), debts: await count(s.financeDebts), plans: await count(s.financePlans),
      days: await count(s.workoutDays), items: await count(s.workoutDayExercises),
    };
  }

  test("snapshot одного владельца не содержит данных другого", async () => {
    const a = newTelegramId();
    const b = newTelegramId();
    await seedOwner(a, "A");
    await seedOwner(b, "B");
    const snapshotA = JSON.stringify(await snapshotOf(a, "2026-03-10"));
    assert.ok(snapshotA.includes("Еда-A") && snapshotA.includes("Счёт-A") && snapshotA.includes("Должник-A") && snapshotA.includes("День-A"));
    for (const marker of ["Еда-B", "Счёт-B", "Трата-B", "Должник-B", "План-B", "День-B", "Упр-B"]) assert.ok(!snapshotA.includes(marker), `${marker} протёк в snapshot A`);
  });

  test("команды удаления и изменения с чужим uuid не меняют строки владельца", async () => {
    const a = newTelegramId();
    const b = newTelegramId();
    const A = await seedOwner(a, "A2");
    const B = await seedOwner(b, "B2");
    const before = await counts(A.owner.id);

    // Тихие команды: эффекта нет.
    await run(b, { type: "food.delete", id: A.food.id });
    await run(b, { type: "money.delete", id: A.entry.id });
    await run(b, { type: "food.save", id: A.food.id, label: "Взлом", portionLabel: "1", occurredAt: T, calories: 1, proteinGrams: 1, fatGrams: 1, carbsGrams: 1 });
    await run(b, { type: "day.save", id: A.day.id, name: "Взлом", weekday: null });
    await run(b, { type: "recurring.save", id: uuid(), name: "x", amountMinor: 1, accountId: B.acc.id, category: "x", frequency: "monthly", nextDueAt: T });

    // Команды с явным 404 / отказом.
    await rejectsWith(run(b, { type: "day.delete", id: A.day.id }), 404);
    await rejectsWith(run(b, { type: "money.save", id: A.entry.id, label: "Взлом", occurredAt: T, amountMinor: 1, accountId: B.acc.id, category: "Еда", kind: "expense" }), 404);
    await rejectsWith(run(b, { type: "money.save", label: "На чужой счёт", occurredAt: T, amountMinor: 1, accountId: A.acc.id, category: "Еда", kind: "expense" }), 400);
    await rejectsWith(run(b, { type: "finance-plan.delete", id: A.plan.id }), 404);
    await rejectsWith(run(b, { type: "finance-plan.save", id: A.plan.id, name: "Взлом", amountMinor: 1 }), 404);
    await rejectsWith(run(b, { type: "debt.repayment.create", id: A.debt.id, amountMinor: 100, accountId: B.acc.id, occurredAt: T }), 404);
    await rejectsWith(run(b, { type: "exercise.remove", dayId: A.day.id, dayExerciseId: A.item.id }), 404);
    await rejectsWith(run(b, { type: "exercise.update", dayId: A.day.id, dayExerciseId: A.item.id, targetSets: 1, targetRepetitions: 1, restSeconds: 0 }), 404);
    await rejectsWith(run(b, { type: "exercise.add", dayId: A.day.id, name: "Чужое", targetSets: 1, targetRepetitions: 1 }), 404);
    await rejectsWith(run(b, { type: "session.start", dayId: A.day.id }), 404);
    await rejectsWith(run(b, { type: "set.save", dayId: A.day.id, exerciseId: A.item.id, setIndex: 1, weightKg: 1, repetitions: 1, durationSeconds: null, distanceMeters: null }), 404);
    await rejectsWith(run(b, { type: "template.save", foodEntryId: A.food.id, name: "Чужая" }), 404);
    await rejectsWith(run(b, { type: "draft.reject", id: uuid() }), 404);

    assert.deepEqual(await counts(A.owner.id), before);
    const [food] = await db.select().from(s.nutritionEntries).where(eq(s.nutritionEntries.id, A.food.id));
    assert.equal(food.name, "Еда-A2");
    const [day] = await db.select().from(s.workoutDays).where(eq(s.workoutDays.id, A.day.id));
    assert.equal(day.name, "День-A2");
    assert.equal(day.isArchived, false);
    const [plan] = await db.select().from(s.financePlans).where(eq(s.financePlans.id, A.plan.id));
    assert.equal(plan.name, "План-A2");
    // Данные B тоже целы, и ничего чужого к ним не добавилось.
    assert.equal((await counts(B.owner.id)).items, 1);
    assert.equal((await db.select().from(s.workoutSessions).where(eq(s.workoutSessions.ownerId, B.owner.id))).length, 0);
  });

  test("удаление своих данных не затрагивает другого владельца", async () => {
    const a = newTelegramId();
    const b = newTelegramId();
    const A = await seedOwner(a, "A3");
    const B = await seedOwner(b, "B3");
    const before = await counts(B.owner.id);
    await run(a, { type: "food.delete", id: A.food.id });
    await run(a, { type: "money.delete", id: A.entry.id });
    await run(a, { type: "day.delete", id: A.day.id });
    assert.deepEqual(await counts(B.owner.id), before);
  });
});
