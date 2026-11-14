import type { MacroValues } from "./types";
export const EMPTY_MACROS: MacroValues = { calories: 0, proteinGrams: 0, fatGrams: 0, carbsGrams: 0 };
export function sumMacros(rows: MacroValues[]): MacroValues {
  const total = rows.reduce((sum, row) => ({
    calories: sum.calories + row.calories,
    proteinGrams: sum.proteinGrams + row.proteinGrams,
    fatGrams: sum.fatGrams + row.fatGrams,
    carbsGrams: sum.carbsGrams + row.carbsGrams,
  }), { ...EMPTY_MACROS });
  return {
    calories: Math.round(total.calories * 100) / 100,
    proteinGrams: Math.round(total.proteinGrams * 100) / 100,
    fatGrams: Math.round(total.fatGrams * 100) / 100,
    carbsGrams: Math.round(total.carbsGrams * 100) / 100,
  };
}
// Constructing Intl.DateTimeFormat is expensive; snapshots call dateKey for every stored row.
const dateKeyFormatters = new Map<string, Intl.DateTimeFormat>();
export function dateKey(value: Date | string, timeZone = "Europe/Chisinau"): string {
  let formatter = dateKeyFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    dateKeyFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(new Date(value));
  const part = (key: string) => parts.find((p) => p.type === key)?.value ?? "";
  return part("year") + "-" + part("month") + "-" + part("day");
}
export function parseMinor(value: string): number {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(normalized)) throw new Error("Введите сумму с точностью до двух знаков.");
  const [whole, decimal = ""] = normalized.split(".");
  return Number(BigInt(whole) * 100n + BigInt(decimal.padEnd(2, "0")));
}
/**
 * Converts an amount to the owner's base currency. Amounts already in the base currency stay as they are;
 * any other currency needs the manual rate (units of base per one unit of `currency`) captured for it.
 */
export function convertToBaseMinor(amountMinor: number, currency: string, baseCurrency: string, rate: string | null): number {
  if (currency === baseCurrency) return amountMinor;
  if (!rate || !/^\d+(\.\d{1,6})?$/.test(rate) || Number(rate) <= 0) throw new Error(`Для валюты ${currency} нужен ручной курс.`);
  const [whole, decimal = ""] = rate.split(".");
  const factor = 10n ** BigInt(decimal.length);
  const scaled = BigInt(whole) * factor + BigInt(decimal || "0");
  const converted = Number((BigInt(amountMinor) * scaled + factor / 2n) / factor);
  if (!Number.isSafeInteger(converted)) throw new Error("Сумма превышает допустимую точность.");
  return converted;
}
const wholeMoneyFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const fractionalMoneyFormat = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Whole amounts stay short ("27"); amounts with kopecks always show two digits ("0,90", not "0,9"). */
export function formatMoneyAmount(minor: number): string {
  const absolute = Math.abs(Math.round(minor));
  return (absolute % 100 === 0 ? wholeMoneyFormat : fractionalMoneyFormat).format(absolute / 100);
}
