import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { and, eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { foreignCurrencyQuestion, rubleMarkerContradictsBase } from "@/domain/currencies";
import { debtReminderHeadline, debtRemainingMinor } from "@/domain/debts";
import { parseDebtMessage } from "@/domain/debt-message";
import { parseFinancePlanMessage } from "@/domain/finance-plans";
import { resolveMoneyClarification } from "@/server/ai/clarification";
import { createCommandDb, newTelegramId, ownerOf, rejectsWith, run, snapshotOf, uuid, T, type CommandDb } from "./helpers/command-db";

describe("долги и подписки: целостность", () => {
  let ctx: Awaited<ReturnType<typeof createCommandDb>>;
  let db: CommandDb;
  before(async () => { ctx = await createCommandDb(); db = ctx.db; });
  after(async () => { await ctx.client.close(); });

  async function setup(currency = "PRB") {
    const tg = newTelegramId();
    const owner = await ownerOf(db, tg);
    await run(tg, { type: "account.save", name: "Касса", currency, openingBalanceMinor: 100000, isDefault: true });
    const [acc] = await db.select().from(s.financeAccounts).where(eq(s.financeAccounts.ownerId, owner.id));
    return { tg, owner, acc };
  }
  const entries = (ownerId: string) => db.select().from(s.financeEntries).where(eq(s.financeEntries.ownerId, ownerId));
  const balance = async (tg: string, id: string) => (await snapshotOf(tg)).finance.accounts.find((a) => a.id === id)!.balanceMinor;
  const lend = (tg: string, accountId: string, amountMinor = 10000) =>
    run(tg, { type: "debt.create", personName: "Антон", direction: "owed_to_me", amountMinor, openedAs: "transfer", accountId, occurredAt: "2026-03-01T10:00:00.000Z", dueOn: null, note: null });

  test("открытие долга привязано к долгу, debt.delete каскадом удаляет возвраты и операции", async () => {
    const { tg, owner, acc } = await setup();
    await lend(tg, acc.id);
    const [debt] = await db.select().from(s.financeDebts).where(eq(s.financeDebts.ownerId, owner.id));
    const [opening] = await entries(owner.id);
    assert.equal(opening.debtId, debt.id);
    await run(tg, { type: "debt.repayment.create", id: debt.id, amountMinor: 4000, accountId: acc.id, occurredAt: T });
    assert.equal(await balance(tg, acc.id), 100000 - 10000 + 4000);

    await run(tg, { type: "debt.delete", id: debt.id });
    assert.equal((await entries(owner.id)).length, 0);
    assert.equal((await db.select().from(s.financeDebts).where(eq(s.financeDebts.ownerId, owner.id))).length, 0);
    assert.equal(await balance(tg, acc.id), 100000);
  });

  test("debt.delete чистит черновики чата, а чужой и неизвестный id отвечают 404", async () => {
    const { tg, owner, acc } = await setup();
    await lend(tg, acc.id);
    const [debt] = await db.select().from(s.financeDebts).where(eq(s.financeDebts.ownerId, owner.id));
    const [capture] = await db.insert(s.captureDrafts).values({ ownerId: owner.id, kind: "debt", messageText: "Антон вернул 10" }).returning();
    await db.insert(s.financeDebtDrafts).values({ ownerId: owner.id, captureDraftId: capture.id, operation: "repayment", personName: "Антон", direction: "owed_to_me", amount: "10.00", debtId: debt.id, accountId: acc.id, occurredAt: new Date() });

    const other = await setup();
    await rejectsWith(run(other.tg, { type: "debt.delete", id: debt.id }), 404);
    await rejectsWith(run(tg, { type: "debt.delete", id: uuid() }), 404);
    await run(tg, { type: "debt.delete", id: debt.id });
    assert.equal((await db.select().from(s.financeDebtDrafts).where(eq(s.financeDebtDrafts.ownerId, owner.id))).length, 0);
  });

  test("debt.repayment.delete удаляет возврат и его операцию, остаток долга восстанавливается", async () => {
    const { tg, owner, acc } = await setup();
    await lend(tg, acc.id);
    const [debt] = await db.select().from(s.financeDebts).where(eq(s.financeDebts.ownerId, owner.id));
    await run(tg, { type: "debt.repayment.create", id: debt.id, amountMinor: 10000, accountId: acc.id, occurredAt: T });
    assert.equal((await snapshotOf(tg)).finance.debts[0].remainingAmountMinor, 0);
    const [repayment] = await db.select().from(s.financeDebtRepayments).where(eq(s.financeDebtRepayments.debtId, debt.id));

    await rejectsWith(run(tg, { type: "debt.repayment.delete", id: uuid() }), 404);
    await run(tg, { type: "debt.repayment.delete", id: repayment.id });
    const snapshot = await snapshotOf(tg);
    assert.equal(snapshot.finance.debts[0].remainingAmountMinor, 10000);
    assert.equal(snapshot.finance.debts[0].repayments.length, 0);
    assert.equal(await balance(tg, acc.id), 100000 - 10000);
    assert.equal((await entries(owner.id)).length, 1);
  });

  test("операции открытия и возврата долга нельзя править и удалять через финансы", async () => {
    const { tg, owner, acc } = await setup();
    await lend(tg, acc.id);
    const [debt] = await db.select().from(s.financeDebts).where(eq(s.financeDebts.ownerId, owner.id));
    await run(tg, { type: "debt.repayment.create", id: debt.id, amountMinor: 3000, accountId: acc.id, occurredAt: T });
    const rows = await entries(owner.id);
    assert.equal(rows.length, 2);
    for (const row of rows) {
      await rejectsWith(run(tg, { type: "money.save", id: row.id, label: "Правка", occurredAt: T, amountMinor: 999, accountId: acc.id, category: "Прочее", kind: row.entryType }), 409);
      await rejectsWith(run(tg, { type: "money.delete", id: row.id }), 409);
    }
    assert.equal(await balance(tg, acc.id), 100000 - 10000 + 3000);
  });

  test("money.save не перезаписывает source существующей операции", async () => {
    const { tg, owner, acc } = await setup();
    const [category] = await db.insert(s.financeCategories).values({ ownerId: owner.id, name: "Еда", entryType: "expense" }).returning();
    const [row] = await db.insert(s.financeEntries).values({ ownerId: owner.id, accountId: acc.id, categoryId: category.id, name: "Хлеб", entryType: "expense", amount: "10.00", currency: "PRB", occurredAt: new Date(T), source: "chat" }).returning();
    await run(tg, { type: "money.save", id: row.id, label: "Хлеб и молоко", occurredAt: T, amountMinor: 2000, accountId: acc.id, category: "Еда", kind: "expense" });
    const [after] = await db.select().from(s.financeEntries).where(eq(s.financeEntries.id, row.id));
    assert.equal(after.source, "chat");
    assert.equal(after.name, "Хлеб и молоко");
    await run(tg, { type: "money.save", label: "Кофе", occurredAt: T, amountMinor: 500, accountId: acc.id, category: "Еда", kind: "expense" });
    const created = (await entries(owner.id)).find((e) => e.name === "Кофе");
    assert.equal(created?.source, "mini_app");
  });

  test("подтверждение подписки привязано к дате, повтор идемпотентен, recurring.save с чужим id даёт 404", async () => {
    const { tg, owner, acc } = await setup();
    await rejectsWith(run(tg, { type: "recurring.save", id: uuid(), name: "x", amountMinor: 100, accountId: acc.id, category: "Подписки", frequency: "monthly", nextDueAt: T }), 404);
    // Просрочка в несколько месяцев: следующий период — 2026-01-10.
    await run(tg, { type: "recurring.save", name: "Музыка", amountMinor: 500, accountId: acc.id, category: "Подписки", frequency: "monthly", nextDueAt: "2026-01-10T12:00:00.000Z" });
    const [payment] = await db.select().from(s.recurringPayments).where(eq(s.recurringPayments.ownerId, owner.id));
    assert.equal(payment.nextDueOn, "2026-01-10");

    await run(tg, { type: "recurring.confirm", id: payment.id, dueOn: "2026-01-10" });
    await run(tg, { type: "recurring.confirm", id: payment.id, dueOn: "2026-01-10" });
    const expenses = (await entries(owner.id)).filter((e) => e.recurringPaymentId === payment.id);
    assert.equal(expenses.length, 1);
    const [moved] = await db.select().from(s.recurringPayments).where(eq(s.recurringPayments.id, payment.id));
    assert.equal(moved.nextDueOn, "2026-02-10");

    // Кнопка из будущего периода не подтверждает более позднюю дату.
    await rejectsWith(run(tg, { type: "recurring.confirm", id: payment.id, dueOn: "2026-03-10" }), 409);
    assert.equal((await entries(owner.id)).filter((e) => e.recurringPaymentId === payment.id).length, 1);
    // Без даты (старая кнопка) подтверждение работает как раньше.
    await run(tg, { type: "recurring.confirm", id: payment.id });
    assert.equal((await entries(owner.id)).filter((e) => e.recurringPaymentId === payment.id).length, 2);
  });

  test("курс хранится с точностью до десяти знаков", async () => {
    const { tg, owner } = await setup();
    await run(tg, { type: "rate.save", currency: "JPY", rateToBase: "0.0723456789", effectiveAt: "2026-01-01T00:00:00.000Z" });
    const [rate] = await db.select().from(s.exchangeRates).where(and(eq(s.exchangeRates.ownerId, owner.id), eq(s.exchangeRates.currency, "JPY")));
    assert.equal(Number(rate.rateToBase), 0.0723456789);
  });

  test("остаток долга считает одна функция и не уходит ниже нуля", () => {
    assert.equal(debtRemainingMinor(10000, [4000, 3000]), 3000);
    assert.equal(debtRemainingMinor(10000, [10000, 1]), 0);
    assert.equal(debtRemainingMinor(10000, []), 10000);
  });

  test("напоминание о просроченном долге: в срок, потом раз в неделю и не «Сегодня»", () => {
    assert.equal(debtReminderHeadline("i_owe", "Олег", "2026-03-10", "2026-03-09"), null);
    assert.match(debtReminderHeadline("i_owe", "Олег", "2026-03-10", "2026-03-10")!, /^Сегодня срок возврата/);
    assert.equal(debtReminderHeadline("i_owe", "Олег", "2026-03-10", "2026-03-11"), null);
    const weekLater = debtReminderHeadline("owed_to_me", "Олег", "2026-03-10", "2026-03-17")!;
    assert.match(weekLater, /Просрочен/);
    assert.doesNotMatch(weekLater, /Сегодня/);
  });

  describe("профиль с основной валютой EUR", () => {
    test("«руб» в сообщении про план, долг и баланс не превращается в EUR", () => {
      assert.equal(rubleMarkerContradictsBase("Запиши в планы шампунь за 220р", "EUR"), true);
      assert.equal(rubleMarkerContradictsBase("Антон должен мне 500 руб.", "EUR"), true);
      assert.equal(rubleMarkerContradictsBase("Антон должен мне 500₽", "EUR"), true);
      assert.equal(rubleMarkerContradictsBase("Запиши в планы шампунь за 220", "EUR"), false);
      assert.equal(rubleMarkerContradictsBase("шампунь за 220р", "PRB"), false);
      assert.equal(rubleMarkerContradictsBase("шампунь за 220р", "RUB"), false);
      assert.equal(rubleMarkerContradictsBase("шампунь за 220р", null), false);
      assert.match(foreignCurrencyQuestion("EUR"), /EUR/);
      // Сами парсеры по-прежнему разбирают сообщение; решение «переспросить» принимает обработчик чата по базовой валюте.
      assert.ok(parseFinancePlanMessage("Запиши в планы шампунь за 220р"));
      assert.ok(parseDebtMessage("Антон должен мне 500 руб."));
    });

    test("уточнение баланса: «руб» при основной EUR не подставляет EUR, при PRB подставляет PRB", () => {
      const history = [
        { role: "user" as const, text: "У меня на счёте 500 руб." },
        { role: "assistant" as const, text: "Это баланс счёта или операция: доход или расход?" },
      ];
      assert.equal(resolveMoneyClarification("доход", history, "EUR"), null);
      const resolved = resolveMoneyClarification("доход", history, "PRB");
      assert.equal(resolved?.type, "resolved");
      assert.equal(resolved && "money" in resolved ? resolved.money.currency : null, "PRB");
    });
  });
});
