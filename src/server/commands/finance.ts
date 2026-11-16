import { and, eq } from "drizzle-orm";
import type { Transaction } from "@/db/client";
import * as s from "@/db/schema";
import { dateKey } from "@/domain/math";
import { advanceRecurrenceDate } from "@/domain/recurrence";
import { AppError } from "../http";
import { account, baseCurrencyOf, category, decimal, rateAt, ensureBaseCurrency } from "./shared";
import type { CommandHandlers } from "./types";

/** Debt operations change only together with the debt: delete the repayment or the debt in «Долги» and enter it again. */
async function rejectDebtLinked(tx: Transaction, ownerId: string, entry: { id: string; debtId: string | null }, verb: string) {
  if (entry.debtId) throw new AppError(409, `Эта операция открыла долг. Чтобы ${verb} её, удали долг в разделе долгов и внеси заново.`);
  const [linked] = await tx.select({ id: s.financeDebtRepayments.id }).from(s.financeDebtRepayments)
    .where(and(eq(s.financeDebtRepayments.financeEntryId, entry.id), eq(s.financeDebtRepayments.ownerId, ownerId))).limit(1);
  if (linked) throw new AppError(409, `Эта операция записана как возврат долга. Чтобы ${verb} её, удали возврат в разделе долгов и внеси заново.`);
}

export const financeHandlers = {
  "account.save": async ({ tx, owner }, command) => {
    if (command.isDefault) await tx.update(s.financeAccounts).set({ isDefault: false }).where(eq(s.financeAccounts.ownerId, owner.id));
    if (command.id) {
      const [existing] = await tx.select().from(s.financeAccounts).where(and(eq(s.financeAccounts.id, command.id), eq(s.financeAccounts.ownerId, owner.id)));
      if (!existing || existing.currency !== command.currency) throw new AppError(400, "Валюту существующего счёта менять нельзя.");
      await tx.update(s.financeAccounts).set({ name: command.name, isDefault: command.isDefault, openingBalance: decimal(command.openingBalanceMinor) }).where(eq(s.financeAccounts.id, existing.id));
    } else await tx.insert(s.financeAccounts).values({ ownerId: owner.id, name: command.name, currency: command.currency, isDefault: command.isDefault, openingBalance: decimal(command.openingBalanceMinor) });
    if (!command.id) await ensureBaseCurrency(tx, owner.id, command.currency);
  },
  "rate.save": async ({ tx, owner }, command) => {
    if (command.currency === await baseCurrencyOf(tx, owner.id)) throw new AppError(400, "Курс основной валюты к самой себе не задаётся.");
    // The same moment again (a corrected typo) replaces the earlier value instead of failing.
    await tx.insert(s.exchangeRates)
      .values({ ownerId: owner.id, currency: command.currency, rateToBase: command.rateToBase, effectiveAt: command.effectiveAt ? new Date(command.effectiveAt) : new Date() })
      .onConflictDoUpdate({ target: [s.exchangeRates.ownerId, s.exchangeRates.currency, s.exchangeRates.effectiveAt], set: { rateToBase: command.rateToBase } });
  },
  "money.save": async ({ tx, owner }, command) => {
    const chosen = await account(tx, owner.id, command.accountId);
    const group = await category(tx, owner.id, command.category, command.kind);
    const at = new Date(command.occurredAt);
    const [old] = command.id ? await tx.select().from(s.financeEntries).where(and(eq(s.financeEntries.id, command.id), eq(s.financeEntries.ownerId, owner.id))) : [];
    if (old) await rejectDebtLinked(tx, owner.id, old, "изменить");
    const sameMinute = old && Math.floor(old.occurredAt.getTime() / 60_000) === Math.floor(at.getTime() / 60_000);
    const rate = old && old.currency === chosen.currency && sameMinute ? old.rateToBase : await rateAt(tx, owner.id, chosen.currency, at);
    const values = { ownerId: owner.id, accountId: chosen.id, categoryId: group.id, name: command.label, entryType: command.kind, amount: decimal(command.amountMinor), currency: chosen.currency, rateToBase: rate, occurredAt: at };
    if (command.id) {
      if (!old) throw new AppError(404, "Операция не найдена.");
      await tx.update(s.financeEntries).set({ ...values, updatedAt: new Date() }).where(eq(s.financeEntries.id, old.id));
    } else await tx.insert(s.financeEntries).values({ ...values, source: "mini_app" });
  },
  "money.delete": async ({ tx, owner }, command) => {
    const [old] = await tx.select().from(s.financeEntries).where(and(eq(s.financeEntries.id, command.id), eq(s.financeEntries.ownerId, owner.id)));
    if (old) await rejectDebtLinked(tx, owner.id, old, "удалить");
    await tx.delete(s.financeEntries).where(and(eq(s.financeEntries.id, command.id), eq(s.financeEntries.ownerId, owner.id)));
  },
  "finance-plan.save": async ({ tx, owner }, command) => {
    const values = { ownerId: owner.id, name: command.name, amount: decimal(command.amountMinor) };
    if (command.id) {
      const [existing] = await tx.select().from(s.financePlans)
        .where(and(eq(s.financePlans.id, command.id), eq(s.financePlans.ownerId, owner.id)));
      if (!existing) throw new AppError(404, "План покупки не найден.");
      await tx.update(s.financePlans).set({ ...values, updatedAt: new Date() })
        .where(and(eq(s.financePlans.id, existing.id), eq(s.financePlans.ownerId, owner.id)));
    } else {
      await tx.insert(s.financePlans).values(values);
    }
  },
  "finance-plan.delete": async ({ tx, owner }, command) => {
    const [existing] = await tx.select().from(s.financePlans)
      .where(and(eq(s.financePlans.id, command.id), eq(s.financePlans.ownerId, owner.id)));
    if (!existing) throw new AppError(404, "План покупки не найден.");
    await tx.delete(s.financePlans)
      .where(and(eq(s.financePlans.id, command.id), eq(s.financePlans.ownerId, owner.id)));
  },
  "finance-plan.purchase": async ({ tx, owner }, command) => {
    const [plan] = await tx.select().from(s.financePlans)
      .where(and(eq(s.financePlans.id, command.id), eq(s.financePlans.ownerId, owner.id)))
      .for("update");
    if (!plan) throw new AppError(404, "План покупки не найден.");

    const chosen = await account(tx, owner.id, command.accountId);
    const base = await baseCurrencyOf(tx, owner.id);
    if (chosen.currency !== base) throw new AppError(400, `План покупки можно записать только со счёта в основной валюте (${base}).`);
    const group = await category(tx, owner.id, command.category, "expense");
    await tx.insert(s.financeEntries).values({
      ownerId: owner.id,
      accountId: chosen.id,
      categoryId: group.id,
      name: command.label,
      entryType: "expense",
      amount: decimal(command.actualAmountMinor),
      currency: chosen.currency,
      rateToBase: null,
      occurredAt: new Date(command.occurredAt),
      source: "mini_app",
    });
    await tx.delete(s.financePlans)
      .where(and(eq(s.financePlans.id, plan.id), eq(s.financePlans.ownerId, owner.id)));
  },
  "recurring.save": async ({ tx, owner }, command) => {
    const chosen = await account(tx, owner.id, command.accountId);
    const group = await category(tx, owner.id, command.category, "expense");
    const nextDueOn = dateKey(command.nextDueAt, owner.timezone);
    const [, month, day] = nextDueOn.split("-").map(Number);
    const values = { ownerId: owner.id, accountId: chosen.id, categoryId: group.id, name: command.name, amount: decimal(command.amountMinor), currency: chosen.currency, nextDueOn, anchorDay: day, anchorMonth: month, intervalUnit: ({ weekly: "week", monthly: "month", yearly: "year" } as const)[command.frequency] };
    if (command.id) {
      const updated = await tx.update(s.recurringPayments).set(values).where(and(eq(s.recurringPayments.id, command.id), eq(s.recurringPayments.ownerId, owner.id))).returning({ id: s.recurringPayments.id });
      if (!updated.length) throw new AppError(404, "Платёж не найден.");
    } else await tx.insert(s.recurringPayments).values(values);
  },
  "recurring.confirm": async ({ tx, owner }, command) => {
    const [payment] = await tx.select().from(s.recurringPayments).where(and(eq(s.recurringPayments.id, command.id), eq(s.recurringPayments.ownerId, owner.id))).for("update");
    if (!payment) throw new AppError(404, "Платёж не найден.");
    // The button is bound to the period it was shown for: a repeated press for an already paid period does nothing.
    if (command.dueOn && command.dueOn < payment.nextDueOn) return;
    if (command.dueOn && command.dueOn > payment.nextDueOn) throw new AppError(409, "Дата платежа изменилась. Открой платёж заново.");
    const today = dateKey(new Date(), owner.timezone);
    if (payment.nextDueOn > today) throw new AppError(409, "Этот период уже оплачен или ещё не наступил.");
    const rate = await rateAt(tx, owner.id, payment.currency, new Date());
    await tx.insert(s.financeEntries).values({ ownerId: owner.id, accountId: payment.accountId, categoryId: payment.categoryId, recurringPaymentId: payment.id, name: payment.name, entryType: "expense", amount: payment.amount, currency: payment.currency, rateToBase: rate, occurredAt: new Date(), source: "recurring" });
    const nextDueOn = advanceRecurrenceDate(payment.nextDueOn, payment.intervalUnit as "day" | "week" | "month" | "year", payment.intervalCount, payment.anchorDay, payment.anchorMonth);
    await tx.update(s.recurringPayments).set({ nextDueOn, lastPaidOn: today }).where(eq(s.recurringPayments.id, payment.id));
  },
} satisfies Partial<CommandHandlers>;
