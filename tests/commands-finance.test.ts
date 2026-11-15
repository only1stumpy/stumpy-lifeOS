import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { and, eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { createCommandDb, newTelegramId, ownerOf, rejectsWith, run, snapshotOf, uuid, T, type CommandDb } from "./helpers/command-db";

describe("команды финансов", () => {
  let ctx: Awaited<ReturnType<typeof createCommandDb>>;
  let db: CommandDb;
  before(async () => { ctx = await createCommandDb(); db = ctx.db; });
  after(async () => { await ctx.client.close(); });

  async function accounts(ownerId: string) {
    return db.select().from(s.financeAccounts).where(eq(s.financeAccounts.ownerId, ownerId));
  }
  async function entries(ownerId: string) {
    return db.select().from(s.financeEntries).where(eq(s.financeEntries.ownerId, ownerId)).orderBy(s.financeEntries.occurredAt);
  }

  test("первый счёт задаёт основную валюту, второй её не меняет", async () => {
    const tg = newTelegramId();
    const owner = await ownerOf(db, tg);
    assert.equal(owner.baseCurrency, null);
    await run(tg, { type: "account.save", name: "Касса", currency: "PRB", openingBalanceMinor: 100000, isDefault: true });
    await run(tg, { type: "account.save", name: "Карта USD", currency: "USD", openingBalanceMinor: 0 });
    const [updated] = await db.select().from(s.ownerSettings).where(eq(s.ownerSettings.id, owner.id));
    assert.equal(updated.baseCurrency, "PRB");
    assert.equal((await accounts(owner.id)).length, 2);
  });

  test("операция в неосновной валюте без курса отклоняется, с курсом хранит курс на свою дату", async () => {
    const tg = newTelegramId();
    const owner = await ownerOf(db, tg);
    await run(tg, { type: "account.save", name: "Касса", currency: "PRB", isDefault: true });
    await run(tg, { type: "account.save", name: "USD", currency: "USD" });
    const [usd] = (await accounts(owner.id)).filter((a) => a.currency === "USD");
    const op = { type: "money.save", label: "Кофе", occurredAt: "2026-02-01T10:00:00.000Z", amountMinor: 500, accountId: usd.id, category: "Еда", kind: "expense" };
    await rejectsWith(run(tg, op), 400);
    assert.equal((await entries(owner.id)).length, 0);

    await run(tg, { type: "rate.save", currency: "USD", rateToBase: "11.5", effectiveAt: "2026-01-01T00:00:00.000Z" });
    await run(tg, op);
    // Смена курса позже не пересчитывает сохранённую операцию.
    await run(tg, { type: "rate.save", currency: "USD", rateToBase: "12", effectiveAt: "2026-03-01T00:00:00.000Z" });
    await run(tg, { ...op, label: "Обед", occurredAt: "2026-03-05T10:00:00.000Z" });
    await run(tg, { ...op, label: "Ужин", occurredAt: "2026-02-15T10:00:00.000Z" });
    const rows = await entries(owner.id);
    const byName = Object.fromEntries(rows.map((r) => [r.name, Number(r.rateToBase)]));
    assert.deepEqual(byName, { Кофе: 11.5, Ужин: 11.5, Обед: 12 });
    assert.ok(rows.every((r) => r.currency === "USD"));
  });

  test("операция в основной валюте не хранит курс, курс основной валюты к себе задать нельзя", async () => {
    const tg = newTelegramId();
    const owner = await ownerOf(db, tg);
    await run(tg, { type: "account.save", name: "Касса", currency: "PRB", isDefault: true });
    const [acc] = await accounts(owner.id);
    await run(tg, { type: "money.save", label: "Хлеб", occurredAt: T, amountMinor: 1250, accountId: acc.id, category: "Еда", kind: "expense" });
    const [row] = await entries(owner.id);
    assert.equal(row.rateToBase, null);
    assert.equal(Number(row.amount), 12.5);
    await rejectsWith(run(tg, { type: "rate.save", currency: "PRB", rateToBase: "1" }), 400);
  });

  test("money.save с id правит свою операцию, чужой или несуществующий id даёт 404", async () => {
    const tg = newTelegramId();
    const owner = await ownerOf(db, tg);
    await run(tg, { type: "account.save", name: "Касса", currency: "PRB", isDefault: true });
    const [acc] = await accounts(owner.id);
    const op = { type: "money.save", label: "Такси", occurredAt: T, amountMinor: 3000, accountId: acc.id, category: "Транспорт", kind: "expense" };
    await run(tg, op);
    const [row] = await entries(owner.id);
    await run(tg, { ...op, id: row.id, label: "Такси домой", amountMinor: 3500 });
    const [edited] = await entries(owner.id);
    assert.equal(edited.name, "Такси домой");
    assert.equal(Number(edited.amount), 35);
    await rejectsWith(run(tg, { ...op, id: uuid() }), 404);
  });

  test("долг: создание переводом, частичный и полный возврат, остаток и ошибки", async () => {
    const tg = newTelegramId();
    const owner = await ownerOf(db, tg);
    await run(tg, { type: "account.save", name: "Касса", currency: "PRB", openingBalanceMinor: 100000, isDefault: true });
    const [acc] = await accounts(owner.id);
    await run(tg, { type: "debt.create", personName: "Антон", direction: "owed_to_me", amountMinor: 10000, openedAs: "transfer", accountId: acc.id, occurredAt: "2026-03-01T10:00:00.000Z", dueOn: null, note: null });
    const [debt] = await db.select().from(s.financeDebts).where(eq(s.financeDebts.ownerId, owner.id));
    assert.equal(Number(debt.originalAmount), 100);
    // Выдача в долг — расход со счёта.
    assert.deepEqual((await entries(owner.id)).map((e) => e.entryType), ["expense"]);

    await run(tg, { type: "debt.repayment.create", id: debt.id, amountMinor: 4000, accountId: acc.id, occurredAt: "2026-03-02T10:00:00.000Z" });
    await rejectsWith(run(tg, { type: "debt.repayment.create", id: debt.id, amountMinor: 6001, accountId: acc.id, occurredAt: "2026-03-03T10:00:00.000Z" }), 400);
    await run(tg, { type: "debt.repayment.create", id: debt.id, amountMinor: 6000, accountId: acc.id, occurredAt: "2026-03-03T10:00:00.000Z" });
    await rejectsWith(run(tg, { type: "debt.repayment.create", id: debt.id, amountMinor: 100, accountId: acc.id, occurredAt: "2026-03-04T10:00:00.000Z" }), 409);
    const repayments = await db.select().from(s.financeDebtRepayments).where(eq(s.financeDebtRepayments.debtId, debt.id));
    assert.equal(repayments.reduce((sum, r) => sum + Number(r.amount), 0), 100);
    await rejectsWith(run(tg, { type: "debt.repayment.create", id: uuid(), amountMinor: 100, accountId: acc.id, occurredAt: T }), 404);
  });

  test("money.delete операции-возврата долга даёт 409 и не удаляет операцию", async () => {
    const tg = newTelegramId();
    const owner = await ownerOf(db, tg);
    await run(tg, { type: "account.save", name: "Касса", currency: "PRB", isDefault: true });
    const [acc] = await accounts(owner.id);
    await run(tg, { type: "debt.create", personName: "Олег", direction: "i_owe", amountMinor: 5000, openedAs: "opening_balance", dueOn: null, note: null });
    const [debt] = await db.select().from(s.financeDebts).where(eq(s.financeDebts.ownerId, owner.id));
    await run(tg, { type: "debt.repayment.create", id: debt.id, amountMinor: 1000, accountId: acc.id, occurredAt: T });
    const [repayment] = await db.select().from(s.financeDebtRepayments).where(eq(s.financeDebtRepayments.ownerId, owner.id));
    await rejectsWith(run(tg, { type: "money.delete", id: repayment.financeEntryId }), 409);
    assert.equal((await entries(owner.id)).length, 1);
    // Обычную операцию удалить можно.
    await run(tg, { type: "money.save", label: "Чай", occurredAt: T, amountMinor: 100, accountId: acc.id, category: "Еда", kind: "expense" });
    const plain = (await entries(owner.id)).find((e) => e.name === "Чай")!;
    await run(tg, { type: "money.delete", id: plain.id });
    assert.equal((await entries(owner.id)).length, 1);
  });

  test("долг в неосновной валюте и счёт не той валюты отклоняются", async () => {
    const tg = newTelegramId();
    const owner = await ownerOf(db, tg);
    await run(tg, { type: "account.save", name: "Касса", currency: "PRB", isDefault: true });
    await run(tg, { type: "account.save", name: "USD", currency: "USD" });
    const [usd] = (await accounts(owner.id)).filter((a) => a.currency === "USD");
    await rejectsWith(run(tg, { type: "debt.create", personName: "Иван", direction: "i_owe", amountMinor: 1000, openedAs: "transfer", accountId: usd.id, dueOn: null, note: null }), 400);
    assert.equal((await db.select().from(s.financeDebts).where(eq(s.financeDebts.ownerId, owner.id))).length, 0);
  });

  test("смена валюты существующего счёта отклоняется, имя и остаток меняются", async () => {
    const tg = newTelegramId();
    const owner = await ownerOf(db, tg);
    await run(tg, { type: "account.save", name: "Касса", currency: "PRB", isDefault: true });
    const [acc] = await accounts(owner.id);
    await rejectsWith(run(tg, { type: "account.save", id: acc.id, name: "Касса", currency: "USD", isDefault: true }), 400);
    await run(tg, { type: "account.save", id: acc.id, name: "Главная", currency: "PRB", openingBalanceMinor: 777, isDefault: true });
    const [changed] = await accounts(owner.id);
    assert.equal(changed.name, "Главная");
    assert.equal(Number(changed.openingBalance), 7.77);
  });

  test("план покупки: создание, правка, покупка превращает его в расход, неизвестный id даёт 404", async () => {
    const tg = newTelegramId();
    const owner = await ownerOf(db, tg);
    await run(tg, { type: "account.save", name: "Касса", currency: "PRB", isDefault: true });
    const [acc] = await accounts(owner.id);
    await run(tg, { type: "finance-plan.save", name: "Ноутбук", amountMinor: 100000 });
    const [plan] = await db.select().from(s.financePlans).where(eq(s.financePlans.ownerId, owner.id));
    await run(tg, { type: "finance-plan.save", id: plan.id, name: "Ноутбук 2", amountMinor: 120000 });
    await run(tg, { type: "finance-plan.purchase", id: plan.id, label: "Ноутбук", actualAmountMinor: 110000, occurredAt: T, accountId: acc.id, category: "Техника" });
    assert.equal((await db.select().from(s.financePlans).where(eq(s.financePlans.ownerId, owner.id))).length, 0);
    assert.equal(Number((await entries(owner.id))[0].amount), 1100);
    await rejectsWith(run(tg, { type: "finance-plan.delete", id: plan.id }), 404);
  });

  test("snapshot считает баланс счёта по операциям", async () => {
    const tg = newTelegramId();
    const owner = await ownerOf(db, tg);
    await run(tg, { type: "account.save", name: "Касса", currency: "PRB", openingBalanceMinor: 10000, isDefault: true });
    const [acc] = await accounts(owner.id);
    await run(tg, { type: "money.save", label: "Зарплата", occurredAt: T, amountMinor: 5000, accountId: acc.id, category: "Работа", kind: "income" });
    await run(tg, { type: "money.save", label: "Обед", occurredAt: T, amountMinor: 1500, accountId: acc.id, category: "Еда", kind: "expense" });
    const snapshot = await snapshotOf(tg);
    const balance = JSON.stringify(snapshot).match(/"balanceMinor":(-?\d+)/);
    assert.equal(Number(balance?.[1]), 13500);
    const [again] = await db.select().from(s.financeAccounts).where(and(eq(s.financeAccounts.ownerId, owner.id)));
    assert.equal(again.id, acc.id);
  });
});
