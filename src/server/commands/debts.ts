import { and, eq, inArray, or } from "drizzle-orm";
import type { Transaction } from "@/db/client";
import * as s from "@/db/schema";
import { AppError } from "../http";
import { debtRemainingMinor } from "@/domain/debts";
import { account, baseCurrencyOf, category, toMinor, debtAmountFromMinor } from "./shared";
import type { CommandHandlers } from "./types";

export async function saveDebtTransfer(
  tx: Transaction,
  ownerId: string,
  input: { personName: string; direction: "i_owe" | "owed_to_me"; amountMinor: number; openedAs: "transfer" | "opening_balance"; accountId?: string; occurredAt: Date; dueOn: string | null; note: string | null; captureDraftId?: string },
) {
  const [debt] = await tx.insert(s.financeDebts).values({
    ownerId,
    personName: input.personName,
    direction: input.direction,
    originalAmount: debtAmountFromMinor(input.amountMinor),
    openedAs: input.openedAs,
    dueOn: input.dueOn,
    note: input.note,
  }).returning();

  if (input.openedAs === "transfer") {
    const base = await baseCurrencyOf(tx, ownerId);
    const chosen = await account(tx, ownerId, input.accountId, base);
    if (chosen.currency !== base) throw new AppError(400, `Долги учитываются только в основной валюте (${base}).`);
    const isIncoming = input.direction === "i_owe";
    const entryType = isIncoming ? "income" : "expense";
    const group = await category(tx, ownerId, isIncoming ? "Получено в долг" : "Выдано в долг", entryType);
    await tx.insert(s.financeEntries).values({
      ownerId,
      captureDraftId: input.captureDraftId,
      accountId: chosen.id,
      categoryId: group.id,
      name: isIncoming ? `Занял у ${input.personName}` : `Одолжил ${input.personName}`,
      entryType,
      amount: debtAmountFromMinor(input.amountMinor),
      currency: chosen.currency,
      rateToBase: null,
      occurredAt: input.occurredAt,
      source: input.captureDraftId ? "chat" : "mini_app",
      debtId: debt.id,
    });
  }
  return debt;
}

export async function saveDebtRepayment(
  tx: Transaction,
  ownerId: string,
  input: { debtId: string; amountMinor: number; accountId: string; occurredAt: Date; captureDraftId?: string },
) {
  const [debt] = await tx.select().from(s.financeDebts)
    .where(and(eq(s.financeDebts.id, input.debtId), eq(s.financeDebts.ownerId, ownerId)));
  if (!debt) throw new AppError(404, "Долг не найден.");

  const repayments = await tx.select().from(s.financeDebtRepayments)
    .where(and(eq(s.financeDebtRepayments.debtId, debt.id), eq(s.financeDebtRepayments.ownerId, ownerId)));
  const remainingMinor = debtRemainingMinor(toMinor(debt.originalAmount), repayments.map((row) => toMinor(row.amount)));
  if (remainingMinor <= 0) throw new AppError(409, "Этот долг уже закрыт.");
  if (input.amountMinor > remainingMinor) throw new AppError(400, "Сумма возврата больше остатка долга.");

  const base = await baseCurrencyOf(tx, ownerId);
  const chosen = await account(tx, ownerId, input.accountId, base);
  if (chosen.currency !== base) throw new AppError(400, `Долги учитываются только в основной валюте (${base}).`);
  const isOutgoing = debt.direction === "i_owe";
  const entryType = isOutgoing ? "expense" : "income";
  const group = await category(tx, ownerId, isOutgoing ? "Погашение долга" : "Возврат долга", entryType);
  const [entry] = await tx.insert(s.financeEntries).values({
    ownerId,
    captureDraftId: input.captureDraftId,
    accountId: chosen.id,
    categoryId: group.id,
    name: isOutgoing ? `Вернул ${debt.personName}` : `Получил возврат от ${debt.personName}`,
    entryType,
    amount: debtAmountFromMinor(input.amountMinor),
    currency: chosen.currency,
    rateToBase: null,
    occurredAt: input.occurredAt,
    source: input.captureDraftId ? "chat" : "mini_app",
  }).returning();
  await tx.insert(s.financeDebtRepayments).values({
    ownerId,
    debtId: debt.id,
    financeEntryId: entry.id,
    amount: debtAmountFromMinor(input.amountMinor),
    occurredAt: input.occurredAt,
  });
  return { debt, entry, remainingMinor: remainingMinor - input.amountMinor };
}

export const debtsHandlers = {
  "debt.create": async ({ tx, owner }, command) => {
    await saveDebtTransfer(tx, owner.id, {
      personName: command.personName,
      direction: command.direction,
      amountMinor: command.amountMinor,
      openedAs: command.openedAs,
      accountId: command.accountId,
      occurredAt: command.occurredAt ? new Date(command.occurredAt) : new Date(),
      dueOn: command.dueOn,
      note: command.note,
    });
  },
  "debt.repayment.create": async ({ tx, owner }, command) => {
    await saveDebtRepayment(tx, owner.id, {
      debtId: command.id,
      amountMinor: command.amountMinor,
      accountId: command.accountId,
      occurredAt: new Date(command.occurredAt),
    });
  },
  // Deleting a debt removes its repayments and the operations they created, so balances stay consistent.
  "debt.delete": async ({ tx, owner }, command) => {
    const [debt] = await tx.select({ id: s.financeDebts.id }).from(s.financeDebts)
      .where(and(eq(s.financeDebts.id, command.id), eq(s.financeDebts.ownerId, owner.id))).for("update");
    if (!debt) throw new AppError(404, "Долг не найден.");
    const repayments = await tx.select({ entryId: s.financeDebtRepayments.financeEntryId }).from(s.financeDebtRepayments)
      .where(and(eq(s.financeDebtRepayments.debtId, debt.id), eq(s.financeDebtRepayments.ownerId, owner.id)));
    await tx.delete(s.financeDebtRepayments).where(and(eq(s.financeDebtRepayments.debtId, debt.id), eq(s.financeDebtRepayments.ownerId, owner.id)));
    // Chat drafts that point at the debt would block the delete (restrict); the debt they described no longer exists.
    await tx.delete(s.financeDebtDrafts).where(and(eq(s.financeDebtDrafts.debtId, debt.id), eq(s.financeDebtDrafts.ownerId, owner.id)));
    await tx.delete(s.financeEntries).where(and(eq(s.financeEntries.ownerId, owner.id), or(
      eq(s.financeEntries.debtId, debt.id),
      repayments.length ? inArray(s.financeEntries.id, repayments.map((row) => row.entryId)) : undefined,
    )));
    await tx.delete(s.financeDebts).where(and(eq(s.financeDebts.id, debt.id), eq(s.financeDebts.ownerId, owner.id)));
  },
  "debt.repayment.delete": async ({ tx, owner }, command) => {
    const [repayment] = await tx.select().from(s.financeDebtRepayments)
      .where(and(eq(s.financeDebtRepayments.id, command.id), eq(s.financeDebtRepayments.ownerId, owner.id))).for("update");
    if (!repayment) throw new AppError(404, "Возврат не найден.");
    await tx.delete(s.financeDebtRepayments).where(eq(s.financeDebtRepayments.id, repayment.id));
    await tx.delete(s.financeEntries).where(and(eq(s.financeEntries.id, repayment.financeEntryId), eq(s.financeEntries.ownerId, owner.id)));
  },
} satisfies Partial<CommandHandlers>;
