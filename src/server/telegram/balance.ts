import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { InlineKeyboard } from "grammy";
import * as schema from "@/db/schema";
import { getDb } from "@/db/client";
import { formatBalanceLines, matchAccountByName, openingBalanceFor, parseSetBalanceMessage, type BalanceAccount } from "@/domain/balance";
import { formatMoneyPlain } from "@/domain/currencies";
import { ensureOwner, executeCommand } from "@/server/lifeos";
import { AppError } from "@/server/http";

/** numeric(20,10) comes back as "20.0000000000"; the converter accepts at most six decimals. */
const normalizeRate = (value: string) => Number(value).toFixed(6).replace(/\.?0+$/, "");
const toMinor = (value: string) => Math.round(Number(value) * 100);

/** Balances computed by SQL, same rule as the snapshot: opening balance + income − expense on each active account. */
export async function loadBalances(): Promise<{ accounts: BalanceAccount[]; baseCurrency: string; rates: Record<string, string> }> {
  const owner = await ensureOwner();
  const db = getDb();
  const [accounts, sums, rateRows] = await Promise.all([
    db.select().from(schema.financeAccounts)
      .where(and(eq(schema.financeAccounts.ownerId, owner.id), eq(schema.financeAccounts.isArchived, false)))
      .orderBy(schema.financeAccounts.createdAt),
    db.select({
      accountId: schema.financeEntries.accountId,
      total: sql<string>`coalesce(sum(case when ${schema.financeEntries.entryType} = 'income' then ${schema.financeEntries.amount} else -${schema.financeEntries.amount} end), 0)`,
    }).from(schema.financeEntries).where(eq(schema.financeEntries.ownerId, owner.id)).groupBy(schema.financeEntries.accountId),
    db.select().from(schema.exchangeRates).where(eq(schema.exchangeRates.ownerId, owner.id)).orderBy(desc(schema.exchangeRates.effectiveAt)),
  ]);
  const rates: Record<string, string> = {};
  for (const row of rateRows) if (!(row.currency in rates)) rates[row.currency] = normalizeRate(row.rateToBase);
  const moved = new Map(sums.map((row) => [row.accountId, toMinor(row.total)]));
  return {
    baseCurrency: owner.baseCurrency ?? accounts[0]?.currency ?? "",
    rates,
    accounts: accounts.map((account) => ({
      id: account.id,
      name: account.name,
      currency: account.currency,
      isDefault: account.isDefault,
      openingBalanceMinor: toMinor(account.openingBalance),
      balanceMinor: toMinor(account.openingBalance) + (moved.get(account.id) ?? 0),
    })),
  };
}

/** Accounts touched by the given confirmed drafts (money entries and debt operations), without duplicates. */
export async function accountIdsOfDrafts(draftIds: readonly string[]): Promise<string[]> {
  if (!draftIds.length) return [];
  const owner = await ensureOwner();
  const db = getDb();
  const rows = await db.select({ accountId: schema.financeEntries.accountId }).from(schema.financeEntries)
    .where(and(eq(schema.financeEntries.ownerId, owner.id), inArray(schema.financeEntries.captureDraftId, [...draftIds])));
  return [...new Set(rows.map((row) => row.accountId))];
}

/** Lines "Остаток на …" for the accounts an operation just changed; empty when it changed none. */
export async function balanceAfter(accountIds: readonly string[]): Promise<string[]> {
  if (!accountIds.length) return [];
  const { accounts, baseCurrency, rates } = await loadBalances();
  return formatBalanceLines(accounts, accountIds, baseCurrency, rates);
}

// «поставь баланс» — a stateless draft: the button carries the account and the target balance, nothing is stored before «Записать».
export const BALANCE_SET = "balset";
export const BALANCE_EDIT = "baled";
export const BALANCE_CANCEL = "balno";

export type SetBalanceReply = { text: string; keyboard?: InlineKeyboard } | null;

/** Null when the text is not a «поставь баланс» command. No AI involved. */
export async function answerSetBalanceMessage(text: string): Promise<SetBalanceReply> {
  const intent = parseSetBalanceMessage(text);
  if (!intent) return null;
  const { accounts } = await loadBalances();
  if (!accounts.length) return { text: "Счетов пока нет. Открой Mini App → Финансы и добавь первый счёт с остатком." };
  const match = matchAccountByName(accounts, intent.accountQuery);
  if (match.kind === "none") {
    return { text: `Не нашёл счёт «${intent.accountQuery}». Твои счета: ${accounts.map((account) => `«${account.name}»`).join(", ")}. Напиши, например: «поставь баланс ${accounts[0].name} ${Math.round(intent.targetMinor / 100)}».` };
  }
  if (match.kind === "ambiguous") {
    return { text: `Какой счёт имеешь в виду: ${match.accounts.map((account) => `«${account.name}»`).join(", ")}? Напиши ещё раз с точным названием.` };
  }
  const { account } = match;
  const diff = intent.targetMinor - account.balanceMinor;
  const lines = [
    "Проверь, пожалуйста",
    `Баланс счёта «${account.name}»: ${formatMoneyPlain(account.balanceMinor, account.currency)} → ${formatMoneyPlain(intent.targetMinor, account.currency)}`,
    diff === 0
      ? "Сейчас уже столько."
      : "Поменяю начальный остаток счёта, операция задним числом не создаётся. Записанные траты и доходы останутся как есть.",
  ];
  return {
    text: lines.join("\n"),
    keyboard: new InlineKeyboard()
      .text("Записать", `${BALANCE_SET}:${account.id}:${intent.targetMinor}`)
      .text("Исправить", `${BALANCE_EDIT}:${account.id}`)
      .row()
      .text("Отменить", `${BALANCE_CANCEL}:${account.id}`),
  };
}

/** «Записать» under a balance draft: the opening balance is recomputed from the balance at this moment, so a repeat press changes nothing. */
export async function applyBalanceTarget(accountId: string, targetMinor: number): Promise<string> {
  if (!Number.isSafeInteger(targetMinor) || Math.abs(targetMinor) > 1_000_000_000_000) throw new AppError(400, "Кнопка устарела.");
  const { accounts } = await loadBalances();
  const account = accounts.find((item) => item.id === accountId);
  if (!account) throw new AppError(404, "Счёт не найден или уже в архиве.");
  await executeCommand({
    type: "account.save",
    id: account.id,
    name: account.name,
    currency: account.currency,
    openingBalanceMinor: openingBalanceFor(targetMinor, account),
    isDefault: account.isDefault ?? false,
  });
  const after = await balanceAfter([account.id]);
  return [`Готово: баланс счёта «${account.name}» теперь ${formatMoneyPlain(targetMinor, account.currency)}.`, ...after.slice(1)].join("\n");
}
