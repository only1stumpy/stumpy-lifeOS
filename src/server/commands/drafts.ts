import { and, eq } from "drizzle-orm";
import type { Transaction } from "@/db/client";
import * as s from "@/db/schema";
import { AppError } from "../http";
import { account, baseCurrencyOf, category, toMinor, macroNumbers, macroStrings, rateAt } from "./shared";
import type { CommandHandlers } from "./types";
import { saveDebtRepayment, saveDebtTransfer } from "./debts";

export async function setPendingMoneyDraftCategory(
  tx: Transaction,
  ownerId: string,
  draftId: string,
  name: string,
): Promise<void> {
  const [draft] = await tx.select().from(s.captureDrafts)
    .where(and(eq(s.captureDrafts.id, draftId), eq(s.captureDrafts.ownerId, ownerId)))
    .for("update");
  if (!draft) throw new AppError(404, "Черновик не найден.");
  if (draft.status !== "pending") throw new AppError(409, "Черновик уже отменён.");

  const [money] = await tx.select().from(s.moneyDrafts)
    .where(and(eq(s.moneyDrafts.captureDraftId, draftId), eq(s.moneyDrafts.ownerId, ownerId)));
  if (!money) throw new AppError(400, "Черновик не содержит финансовую операцию.");

  const group = await category(tx, ownerId, name, money.entryType as "expense" | "income");
  await tx.update(s.moneyDrafts)
    .set({ categoryId: group.id, proposedCategory: group.name })
    .where(and(eq(s.moneyDrafts.captureDraftId, draftId), eq(s.moneyDrafts.ownerId, ownerId)));
}

export function missingMoneyCategoryMessage(entryType: "expense" | "income"): string {
  const categoryKind = entryType === "income" ? "дохода" : "расхода";
  return `Уточни категорию ${categoryKind} через «Исправить».`;
}

/** The short AI clarification history holds user text too; it ends together with the draft it belonged to. */
async function clearClarification(tx: Transaction, ownerId: string): Promise<void> {
  await tx.update(s.ownerSettings).set({ aiClarificationHistory: null, aiClarificationUpdatedAt: null }).where(eq(s.ownerSettings.id, ownerId));
}

export const draftsHandlers = {
  "draft.reject": async ({ tx, owner }, command) => {
    const [draft] = await tx.select({ status: s.captureDrafts.status }).from(s.captureDrafts)
      .where(and(eq(s.captureDrafts.id, command.id), eq(s.captureDrafts.ownerId, owner.id))).for("update");
    if (!draft) throw new AppError(404, "Черновик не найден.");
    if (draft.status === "confirmed") throw new AppError(409, "Черновик уже записан, отменить его нельзя. Удали запись.");
    if (draft.status === "pending") {
      // The original message text is only needed to edit a pending draft: drop it as soon as the draft is closed.
      await tx.update(s.captureDrafts).set({ status: "cancelled", messageText: null }).where(and(eq(s.captureDrafts.id, command.id), eq(s.captureDrafts.ownerId, owner.id)));
      await clearClarification(tx, owner.id);
    }
  },
  "draft.money-category.set": async ({ tx, owner }, command) => {
    await setPendingMoneyDraftCategory(tx, owner.id, command.id, command.category);
  },
  "draft.confirm": async ({ tx, owner }, command) => {
    const [draft] = await tx.select().from(s.captureDrafts).where(and(eq(s.captureDrafts.id, command.id), eq(s.captureDrafts.ownerId, owner.id))).for("update");
    if (!draft) throw new AppError(404, "Черновик не найден.");
    if (draft.status === "confirmed") return;
    if (draft.status !== "pending") throw new AppError(409, "Черновик уже отменён.");
    const [food] = await tx.select().from(s.nutritionDrafts).where(eq(s.nutritionDrafts.captureDraftId, draft.id));
    const [money] = await tx.select().from(s.moneyDrafts).where(eq(s.moneyDrafts.captureDraftId, draft.id));
    const [debt] = await tx.select().from(s.financeDebtDrafts)
      .where(and(eq(s.financeDebtDrafts.captureDraftId, draft.id), eq(s.financeDebtDrafts.ownerId, owner.id)));
    if (food) await tx.insert(s.nutritionEntries).values({ ownerId: owner.id, captureDraftId: draft.id, name: food.name, portionLabel: food.portionLabel, ...macroStrings(macroNumbers(food)), occurredAt: food.occurredAt, estimated: food.estimated });
    if (money && draft.kind === "plan") {
      // A purchase plan is not an expense: it goes to the plans list.
      await tx.insert(s.financePlans).values({ ownerId: owner.id, name: money.name, amount: money.amount });
    } else if (money) {
      if (!money.proposedCategory && !money.categoryId) throw new AppError(400, missingMoneyCategoryMessage(money.entryType === "income" ? "income" : "expense"));
      const chosen = await account(tx, owner.id, money.accountId ?? undefined, money.currency);
      const group = money.categoryId ? null : await category(tx, owner.id, money.proposedCategory!, money.entryType as "expense" | "income");
      const rate = await rateAt(tx, owner.id, chosen.currency, money.occurredAt);
      await tx.insert(s.financeEntries).values({ ownerId: owner.id, captureDraftId: draft.id, accountId: chosen.id, categoryId: money.categoryId ?? group!.id, entryType: money.entryType, name: money.name, amount: money.amount, currency: chosen.currency, rateToBase: rate, baseCurrencyEpoch: owner.baseCurrencyEpoch, occurredAt: money.occurredAt });
    }
    if (debt) {
      if (debt.operation === "create") {
        await saveDebtTransfer(tx, owner.id, {
          personName: debt.personName,
          direction: debt.direction as "i_owe" | "owed_to_me",
          amountMinor: toMinor(debt.amount),
          openedAs: debt.openedAs as "transfer" | "opening_balance",
          accountId: debt.accountId ?? undefined,
          occurredAt: debt.occurredAt,
          dueOn: debt.dueOn,
          note: debt.note,
          captureDraftId: draft.id,
        });
      } else {
        if (!debt.debtId) throw new AppError(400, "В черновике возврата не хватает долга.");
        const repaymentAccount = debt.accountId ?? (await account(tx, owner.id, undefined, await baseCurrencyOf(tx, owner.id))).id;
        await saveDebtRepayment(tx, owner.id, {
          debtId: debt.debtId,
          amountMinor: toMinor(debt.amount),
          accountId: repaymentAccount,
          occurredAt: debt.occurredAt,
          captureDraftId: draft.id,
        });
      }
    }
    await tx.update(s.captureDrafts).set({ status: "confirmed", confirmedAt: new Date(), messageText: null }).where(eq(s.captureDrafts.id, draft.id));
    await clearClarification(tx, owner.id);
  },
} satisfies Partial<CommandHandlers>;
