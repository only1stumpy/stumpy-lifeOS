import { and, asc, desc, eq, isNull, lte } from "drizzle-orm";
import type { Transaction } from "@/db/client";
import * as s from "@/db/schema";
import type { MacroValues } from "@/domain/types";
import { AppError } from "../http";

export const decimal = (minor: number) => {
  const n = BigInt(minor);
  return (n < 0n ? "-" : "") + String((n < 0n ? -n : n) / 100n) + "." + String((n < 0n ? -n : n) % 100n).padStart(2, "0");
};
export const toMinor = (value: string) => {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace("-", "").split(".");
  const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
  return Number(negative ? -amount : amount);
};
export const macroNumbers = (row: { calories: string; proteinGrams: string; fatGrams: string; carbsGrams: string }): MacroValues => ({
  calories: Number(row.calories), proteinGrams: Number(row.proteinGrams), fatGrams: Number(row.fatGrams), carbsGrams: Number(row.carbsGrams),
});

export const macroStrings = (row: MacroValues) => ({
  calories: String(row.calories), proteinGrams: String(row.proteinGrams), fatGrams: String(row.fatGrams), carbsGrams: String(row.carbsGrams),
});

export async function category(tx: Transaction, ownerId: string, name: string, entryType: "income" | "expense") {
  await tx.insert(s.financeCategories).values({ ownerId, name, entryType }).onConflictDoNothing();
  const [row] = await tx.select().from(s.financeCategories).where(and(eq(s.financeCategories.ownerId, ownerId), eq(s.financeCategories.name, name), eq(s.financeCategories.entryType, entryType)));
  return row;
}

export function debtAmountFromMinor(amountMinor: number): string {
  return decimal(amountMinor);
}

export async function account(tx: Transaction, ownerId: string, accountId?: string, currency?: string) {
  const rows = await tx.select().from(s.financeAccounts).where(and(eq(s.financeAccounts.ownerId, ownerId), eq(s.financeAccounts.isArchived, false)));
  const row = accountId ? rows.find((v) => v.id === accountId) : rows.find((v) => v.isDefault && (!currency || v.currency === currency)) ?? rows.find((v) => !currency || v.currency === currency);
  if (!row) throw new AppError(400, "Сначала добавьте счёт в нужной валюте.");
  return row;
}
/** Base currency of the owner: the currency of the first account. Null until an account exists. */
export async function baseCurrencyOf(tx: Transaction, ownerId: string): Promise<string> {
  const [row] = await tx.select({ base: s.ownerSettings.baseCurrency }).from(s.ownerSettings).where(eq(s.ownerSettings.id, ownerId));
  if (!row?.base) throw new AppError(400, "Сначала добавьте счёт: его валюта станет основной.");
  return row.base;
}
export async function rateAt(tx: Transaction, ownerId: string, currency: string, at: Date) {
  if (currency === await baseCurrencyOf(tx, ownerId)) return null;
  const [rate] = await tx.select().from(s.exchangeRates).where(and(eq(s.exchangeRates.ownerId, ownerId), eq(s.exchangeRates.currency, currency), lte(s.exchangeRates.effectiveAt, at))).orderBy(desc(s.exchangeRates.effectiveAt)).limit(1);
  if (rate) return rate.rateToBase;
  // Nothing was in force yet at that time: take the earliest rate that was set afterwards.
  const [later] = await tx.select().from(s.exchangeRates).where(and(eq(s.exchangeRates.ownerId, ownerId), eq(s.exchangeRates.currency, currency))).orderBy(asc(s.exchangeRates.effectiveAt)).limit(1);
  if (!later) throw new AppError(400, `Для операции в ${currency} нужен ручной курс. Сначала задайте курс.`);
  return later.rateToBase;
}
/** First account decides the base currency; later accounts leave it unchanged. */
export async function ensureBaseCurrency(tx: Transaction, ownerId: string, currency: string) {
  await tx.update(s.ownerSettings).set({ baseCurrency: currency, updatedAt: new Date() }).where(and(eq(s.ownerSettings.id, ownerId), isNull(s.ownerSettings.baseCurrency)));
}
