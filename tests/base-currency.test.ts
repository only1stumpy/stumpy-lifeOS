import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { useDatabaseForTests } from "@/db/client";
import { convertEntryToCurrentBaseMinor } from "@/domain/math";
import { totalInBaseMinor } from "@/domain/balance";
import { commandSchema } from "@/domain/commands";
import { rubleMarkerContradictsBase } from "@/domain/currencies";
import { createBackup, restoreBackup, type BackupDatabase } from "@/server/backup";
import { loadPeriodReport } from "@/server/period-report";
import { withTelegramUser } from "@/server/owner-context";
import { createCommandDb, newTelegramId, ownerOf, rejectsWith, run, snapshotOf, T } from "./helpers/command-db";

let context: Awaited<ReturnType<typeof createCommandDb>>;
before(async () => { context = await createCommandDb(); });
after(async () => { await context.client.close(); });

test("PRB → USD → PRB: итоги, кросс-курсы, долги и снимки операций", async () => {
  const { db } = context;
  useDatabaseForTests(db);
  const tg = newTelegramId();
  const owner = await ownerOf(db, tg);
  await run(tg, { type: "account.save", name: "ПМР", currency: "PRB", openingBalanceMinor: 10000, isDefault: true });
  await run(tg, { type: "account.save", name: "Доллары", currency: "USD", openingBalanceMinor: 1000 });
  await run(tg, { type: "account.save", name: "Евро", currency: "EUR", openingBalanceMinor: 1000 });
  await run(tg, { type: "rate.save", currency: "USD", rateToBase: "20" });
  await run(tg, { type: "rate.save", currency: "EUR", rateToBase: "40" });
  const before = await snapshotOf(tg);
  const usd = before.finance.accounts.find((a) => a.currency === "USD")!;
  await run(tg, { type: "money.save", label: "Покупка", amountMinor: 100, accountId: usd.id, kind: "expense", category: "Продукты", occurredAt: T });
  await run(tg, { type: "finance-plan.save", name: "План", amountMinor: 20000 });
  await run(tg, { type: "debt.create", personName: "Друг", direction: "i_owe", openedAs: "opening_balance", amountMinor: 10000, dueOn: null, note: null });
  const entriesBefore = await db.select().from(s.financeEntries).where(eq(s.financeEntries.ownerId, owner.id));
  await run(tg, { type: "base-currency.change", previousCurrency: "PRB", currency: "USD", rateToNew: "0.05" });
  const inUsd = await snapshotOf(tg);
  assert.equal(inUsd.settings.baseCurrency, "USD");
  assert.equal(Number(inUsd.settings.rates.PRB), 0.05);
  assert.equal(Number(inUsd.settings.rates.EUR), 2);
  assert.equal(totalInBaseMinor(inUsd.finance.accounts, "USD", inUsd.settings.rates), 3400);
  assert.equal(inUsd.finance.plans[0].amountMinor, 1000);
  assert.equal(inUsd.finance.debts[0].remainingAmountMinor, 500);
  assert.equal((await snapshotOf(tg, T.slice(0, 10))).finance.spentTodayMinor, 100);
  assert.equal(rubleMarkerContradictsBase("100 рублей", inUsd.settings.baseCurrency), true);
  assert.equal((await withTelegramUser(tg, () => loadPeriodReport("day", T.slice(0, 10)))).finance?.expenseMinor, 100);
  const entriesAfter = await db.select().from(s.financeEntries).where(eq(s.financeEntries.ownerId, owner.id));
  assert.deepEqual(entriesAfter, entriesBefore);

  const eur = inUsd.finance.accounts.find((a) => a.currency === "EUR")!;
  await run(tg, { type: "money.save", label: "Евро", amountMinor: 100, accountId: eur.id, kind: "expense", category: "Продукты", occurredAt: T });
  const newer = (await db.select().from(s.financeEntries).where(eq(s.financeEntries.ownerId, owner.id))).find((entry) => entry.name === "Евро")!;
  assert.equal(newer.baseCurrencyEpoch, 1);
  assert.equal(Number(newer.rateToBase), 2);
  await run(tg, { type: "rate.save", currency: "PRB", rateToBase: "0.07" });
  const unchanged = await snapshotOf(tg, T.slice(0, 10));
  assert.equal(unchanged.finance.spentTodayMinor, 300);
  await run(tg, { type: "base-currency.change", previousCurrency: "USD", currency: "PRB", rateToNew: "14.2857142857" });
  const returned = await snapshotOf(tg);
  assert.equal(returned.settings.baseCurrency, "PRB");
  assert.equal((await db.select().from(s.baseCurrencyChanges).where(eq(s.baseCurrencyChanges.ownerId, owner.id))).length, 2);
  assert.deepEqual((await db.select().from(s.financeEntries).where(eq(s.financeEntries.ownerId, owner.id))).find((entry) => entry.name === "Покупка"), entriesBefore[0]);
  assert.equal(returned.finance.spentTodayMinor, 0); // Selected day is not the historic expense day.
  assert.equal((await snapshotOf(tg, T.slice(0, 10))).finance.spentTodayMinor, 4286);
  assert.equal(rubleMarkerContradictsBase("100 рублей", returned.settings.baseCurrency), false);
  assert.equal(convertEntryToCurrentBaseMinor(100, entriesBefore[0], "PRB", [
    { epoch: 1, previousCurrency: "PRB", currency: "USD", rateToNew: "0.05" },
    { epoch: 2, previousCurrency: "USD", currency: "PRB", rateToNew: "14.2857142857" },
  ]), 1429);
});

test("нет курса: отказ; ошибка после записи аудита откатывает всю смену", async () => {
  const { db } = context;
  useDatabaseForTests(db);
  const tg = newTelegramId();
  const owner = await ownerOf(db, tg);
  await run(tg, { type: "account.save", name: "ПМР", currency: "PRB" });
  assert.equal(commandSchema.safeParse({ type: "base-currency.change", previousCurrency: "PRB", currency: "USD", rateToNew: "" }).success, false);
  await rejectsWith(run(tg, { type: "base-currency.change", previousCurrency: "USD", currency: "EUR", rateToNew: "2" }), 409);
  await run(tg, { type: "finance-plan.save", name: "Крупный", amountMinor: 1_000_000_000_000 });
  await assert.rejects(run(tg, { type: "base-currency.change", previousCurrency: "PRB", currency: "USD", rateToNew: "9999999999" }));
  assert.equal((await db.select().from(s.ownerSettings).where(eq(s.ownerSettings.id, owner.id)))[0].baseCurrency, "PRB");
  assert.equal((await db.select().from(s.baseCurrencyChanges).where(eq(s.baseCurrencyChanges.ownerId, owner.id))).length, 0);
  assert.equal((await db.select().from(s.financePlans).where(eq(s.financePlans.ownerId, owner.id)))[0].amount, "10000000000.0000");
});

test("ожидающий возврат долга переживает смену без счёта в новой валюте", async () => {
  const { db } = context;
  useDatabaseForTests(db);
  const tg = newTelegramId();
  const owner = await ownerOf(db, tg);
  await run(tg, { type: "account.save", name: "ПМР", currency: "PRB" });
  const [oldAccount] = await db.select().from(s.financeAccounts).where(eq(s.financeAccounts.ownerId, owner.id));
  await run(tg, { type: "debt.create", personName: "Друг", direction: "i_owe", openedAs: "opening_balance", amountMinor: 10000, dueOn: null, note: null });
  const [debt] = await db.select().from(s.financeDebts).where(eq(s.financeDebts.ownerId, owner.id));
  const [capture] = await db.insert(s.captureDrafts).values({ ownerId: owner.id, kind: "debt", status: "pending", messageText: "вернул 20" }).returning();
  await db.insert(s.financeDebtDrafts).values({
    ownerId: owner.id, captureDraftId: capture.id, operation: "repayment", personName: "Друг",
    direction: "i_owe", debtId: debt.id, accountId: oldAccount.id, amount: "20.00", occurredAt: new Date(T),
  });
  await run(tg, { type: "base-currency.change", previousCurrency: "PRB", currency: "USD", rateToNew: "0.05" });
  assert.equal((await db.select().from(s.financeDebtDrafts).where(eq(s.financeDebtDrafts.ownerId, owner.id)))[0].accountId, null);
  await run(tg, { type: "account.save", name: "USD", currency: "USD" });
  await run(tg, { type: "draft.confirm", id: capture.id });
  assert.equal((await snapshotOf(tg)).finance.debts[0].remainingAmountMinor, 400);
});

test("экспорт и импорт сохраняют эпохи; формат 4 получает нулевую эпоху", async () => {
  const { db } = context;
  useDatabaseForTests(db);
  const tg = newTelegramId();
  await ownerOf(db, tg);
  await run(tg, { type: "account.save", name: "ПМР", currency: "PRB" });
  await run(tg, { type: "base-currency.change", previousCurrency: "PRB", currency: "USD", rateToNew: "0.05" });
  const backup = await createBackup(db as unknown as BackupDatabase, tg);
  assert.equal(backup.version, 5);
  assert.equal(backup.tables.baseCurrencyChanges.length, 1);
  const old = { ...backup, version: 4, tables: { ...backup.tables } } as Record<string, unknown> & { tables: Record<string, unknown> };
  delete old.tables.baseCurrencyChanges;
  old.tables.ownerSettings = backup.tables.ownerSettings.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "baseCurrencyEpoch")));
  old.tables.financeEntries = backup.tables.financeEntries.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "baseCurrencyEpoch")));
  const { validateBackup } = await import("@/server/backup");
  assert.equal(validateBackup(old).tables.ownerSettings[0].baseCurrencyEpoch, 0);
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { readFile, readdir } = await import("node:fs/promises");
  const targetClient = new PGlite();
  try {
    for (const name of (await readdir("drizzle")).filter((n) => /^\d+_.+\.sql$/.test(n)).sort()) {
      for (const statement of (await readFile(`drizzle/${name}`, "utf8")).split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean)) await targetClient.exec(statement);
    }
    const target = drizzle(targetClient, { schema: s });
    await restoreBackup(target as unknown as BackupDatabase, backup, tg);
    assert.deepEqual((await createBackup(target as unknown as BackupDatabase, tg)).tables, backup.tables);
  } finally { await targetClient.close(); }
});
