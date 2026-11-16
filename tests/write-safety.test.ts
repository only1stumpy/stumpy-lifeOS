import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { commandSchema } from "@/domain/commands";
import { parseDebtMessage } from "@/domain/debt-message";
import { analyzeMessage } from "@/server/ai/analyze";
import { AIAnalysisError } from "@/server/ai/types";
import { createDebtCaptureDraft, executeCommand } from "@/server/lifeos";
import { withTelegramUser } from "@/server/owner-context";
import { splitForTelegram } from "@/server/telegram/handlers/drafts";
import { createCommandDb, newTelegramId, ownerOf, rejectsWith, run, T, uuid, type CommandDb } from "./helpers/command-db";

const macros = { calories: 250, proteinGrams: 20, fatGrams: 10, carbsGrams: 15 };

describe("безопасность записи: повторы, переполнение, тренировка, чек", () => {
  let ctx: Awaited<ReturnType<typeof createCommandDb>>;
  let db: CommandDb;
  before(async () => { ctx = await createCommandDb(); db = ctx.db; });
  after(async () => { await ctx.client.close(); });

  test("Mini App больше не принимает команду analyze", () => {
    assert.equal(commandSchema.safeParse({ type: "analyze", text: "гречка" }).success, false);
  });

  test("food.save, money.save и debt.create с тем же clientRequestId записываются один раз", async () => {
    const tg = newTelegramId();
    const owner = await ownerOf(db, tg);
    await run(tg, { type: "account.save", name: "Касса", currency: "PRB", openingBalanceMinor: 100000, isDefault: true });
    const [account] = await db.select().from(s.financeAccounts).where(eq(s.financeAccounts.ownerId, owner.id));
    const food = { type: "food.save", clientRequestId: uuid(), label: "Омлет", portionLabel: "1 порция", occurredAt: T, ...macros };
    const money = { type: "money.save", clientRequestId: uuid(), label: "Такси", occurredAt: T, amountMinor: 3000, accountId: account.id, category: "Транспорт", kind: "expense" };
    const debt = { type: "debt.create", clientRequestId: uuid(), personName: "Антон", direction: "owed_to_me", amountMinor: 10000, openedAs: "transfer", accountId: account.id, occurredAt: T, dueOn: null, note: null };
    for (const command of [food, food, money, money, debt, debt]) await run(tg, command);
    assert.equal((await db.select().from(s.nutritionEntries).where(eq(s.nutritionEntries.ownerId, owner.id))).length, 1);
    assert.equal((await db.select().from(s.financeEntries).where(eq(s.financeEntries.ownerId, owner.id))).length, 2, "такси и выдача в долг");
    assert.equal((await db.select().from(s.financeDebts).where(eq(s.financeDebts.ownerId, owner.id))).length, 1);
    // Другой id — это уже другая запись.
    await run(tg, { ...food, clientRequestId: uuid() });
    assert.equal((await db.select().from(s.nutritionEntries).where(eq(s.nutritionEntries.ownerId, owner.id))).length, 2);
  });

  test("неудавшаяся команда не занимает clientRequestId: повтор после ошибки проходит", async () => {
    const tg = newTelegramId();
    const owner = await ownerOf(db, tg);
    const request = { type: "money.save", clientRequestId: uuid(), label: "Кофе", occurredAt: T, amountMinor: 500, accountId: uuid(), category: "Еда", kind: "expense" };
    await rejectsWith(run(tg, request), 400);
    await run(tg, { type: "account.save", name: "Касса", currency: "PRB", isDefault: true });
    const [account] = await db.select().from(s.financeAccounts).where(eq(s.financeAccounts.ownerId, owner.id));
    await run(tg, { ...request, accountId: account.id });
    assert.equal((await db.select().from(s.financeEntries).where(eq(s.financeEntries.ownerId, owner.id))).length, 1);
  });

  test("сумма, чья стоимость в основной валюте выходит за безопасные целые, отклоняется и ничего не пишет", async () => {
    const tg = newTelegramId();
    const owner = await ownerOf(db, tg);
    await run(tg, { type: "account.save", name: "Касса", currency: "PRB", isDefault: true });
    await run(tg, { type: "account.save", name: "Доллары", currency: "USD" });
    await run(tg, { type: "rate.save", currency: "USD", rateToBase: "999999.999999" });
    const accounts = await db.select().from(s.financeAccounts).where(eq(s.financeAccounts.ownerId, owner.id));
    const usd = accounts.find((row) => row.currency === "USD")!;
    const op = { type: "money.save", label: "Слиток", occurredAt: T, accountId: usd.id, category: "Прочее", kind: "expense" };
    await rejectsWith(run(tg, { ...op, amountMinor: 100_000_000_000 }), 400);
    assert.equal((await db.select().from(s.financeEntries).where(eq(s.financeEntries.ownerId, owner.id))).length, 0);
    await run(tg, { ...op, amountMinor: 10_000 });
    assert.equal((await db.select().from(s.financeEntries).where(eq(s.financeEntries.ownerId, owner.id))).length, 1);
  });

  test("упражнение, добавленное во время активной тренировки, сразу доступно для подходов", async () => {
    const tg = newTelegramId();
    const owner = await ownerOf(db, tg);
    await run(tg, { type: "day.save", name: "Грудь" });
    const [day] = await db.select().from(s.workoutDays).where(eq(s.workoutDays.ownerId, owner.id));
    await run(tg, { type: "exercise.add", dayId: day.id, name: "Жим", targetSets: 3, targetRepetitions: 10 });
    await run(tg, { type: "session.start", dayId: day.id });
    await run(tg, { type: "exercise.add", dayId: day.id, name: "Разводка", targetSets: 3, targetRepetitions: 12 });
    const items = await db.select().from(s.workoutDayExercises).where(eq(s.workoutDayExercises.workoutDayId, day.id)).orderBy(s.workoutDayExercises.position);
    assert.equal(items.length, 2);
    await run(tg, { type: "set.save", dayId: day.id, exerciseId: items[1].id, setIndex: 1, weightKg: 20, repetitions: 12, durationSeconds: null, distanceMeters: null });
    const sessionItems = await db.select().from(s.workoutSessionExercises).where(eq(s.workoutSessionExercises.ownerId, owner.id));
    assert.deepEqual(sessionItems.map((row) => row.exerciseName).sort(), ["Жим", "Разводка"]);
    assert.equal((await db.select().from(s.workoutSets).where(eq(s.workoutSets.ownerId, owner.id))).length, 1);
  });

  test("больше 50 шаблонов, 100 категорий и длинная категория не ломают разбор сообщения", async () => {
    const oldFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error("сеть недоступна"); };
    try {
      await analyzeMessage({
        text: "купил хлеб за 20",
        now: "2026-10-28T06:33:00.000Z",
        timeZone: "Europe/Chisinau",
        templates: Array.from({ length: 80 }, (_, index) => ({ name: `Блюдо ${index}`, portionLabel: "1 порция", calories: 100, proteinGrams: 1, fatGrams: 1, carbsGrams: 1 })),
        categories: [...Array.from({ length: 150 }, (_, index) => `Категория ${index}`), "д".repeat(200)],
      }).catch((error: unknown) => {
        assert.ok(!(error instanceof AIAnalysisError && error.code === "invalid_input"), "ограниченный контекст не должен давать invalid_input");
      });
    } finally {
      globalThis.fetch = oldFetch;
    }
  });

  test("длинный ответ на чек делится на части не длиннее 4096 символов без потери строк", () => {
    const lines = Array.from({ length: 300 }, (_, index) => `${index + 1}. Позиция чека · ${index}`);
    const text = lines.join("\n");
    const parts = splitForTelegram(text);
    assert.ok(parts.length > 1);
    assert.ok(parts.every((part) => part.length <= 4096));
    assert.equal(parts.join("\n"), text);
    assert.ok(splitForTelegram("я".repeat(9000)).every((part) => part.length <= 4096));
  });

  test("повтор Telegram update не создаёт второй черновик долга и второй план", async () => {
    const tg = newTelegramId();
    const owner = await ownerOf(db, tg);
    await run(tg, { type: "account.save", name: "Касса", currency: "PRB", openingBalanceMinor: 100000, isDefault: true });
    const [update] = await db.insert(s.telegramUpdates).values({ ownerId: owner.id, telegramUpdateId: Date.now(), payload: {} }).returning();
    const intent = parseDebtMessage("Одолжил Антону 500 рублей");
    assert.ok(intent, "сообщение должно распознаваться как долг");
    const input = { intent, messageText: "Одолжил Антону 500 рублей", telegramUpdateRowId: update.id };
    const first = await withTelegramUser(tg, () => createDebtCaptureDraft(input));
    const second = await withTelegramUser(tg, () => createDebtCaptureDraft(input));
    assert.equal(first.draftIds.length, 1);
    assert.deepEqual(second.draftIds, first.draftIds);
    assert.equal((await db.select().from(s.captureDrafts).where(eq(s.captureDrafts.ownerId, owner.id))).length, 1);

    const plan = commandSchema.parse({ type: "finance-plan.save", name: "Шампунь", amountMinor: 22000 });
    const requestId = `update:${update.id}:plan`;
    await withTelegramUser(tg, () => executeCommand(plan, { requestId }));
    await withTelegramUser(tg, () => executeCommand(plan, { requestId }));
    assert.equal((await db.select().from(s.financePlans).where(eq(s.financePlans.ownerId, owner.id))).length, 1);
  });
});
