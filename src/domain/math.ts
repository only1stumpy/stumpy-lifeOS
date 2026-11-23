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
export function dateKey(value: Date | string, timeZone: string): string {
  let formatter = dateKeyFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    dateKeyFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(new Date(value));
  const part = (key: string) => parts.find((p) => p.type === key)?.value ?? "";
  return part("year") + "-" + part("month") + "-" + part("day");
}

export function isValidTimeZone(timeZone: string): boolean {
  try { new Intl.DateTimeFormat("en", { timeZone }).format(); return true; } catch { return false; }
}
const wallClockFormatters = new Map<string, Intl.DateTimeFormat>();
function wallClockParts(instant: Date, timeZone: string): Record<string, number> {
  let formatter = wallClockFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    wallClockFormatters.set(timeZone, formatter);
  }
  const out: Record<string, number> = {};
  for (const part of formatter.formatToParts(instant)) if (part.type !== "literal") out[part.type] = Number(part.value);
  return out;
}
/** Wall-clock `YYYY-MM-DDTHH:mm` of an instant in the given zone (the value format of `datetime-local`). */
export function instantToZonedLocal(value: Date | string, timeZone: string): string {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return "";
  const p = wallClockParts(instant, timeZone);
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}
/**
 * Instant for a wall-clock `YYYY-MM-DDTHH:mm` in the given zone. A time skipped by a DST jump moves forward
 * by the gap; an ambiguous time (clocks set back) resolves to the earlier occurrence. Null for invalid input.
 */
export function zonedLocalToInstant(local: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/.exec(local);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  if (Number.isNaN(asUtc)) return null;
  const offsetAt = (instantMs: number) => {
    const p = wallClockParts(new Date(instantMs), timeZone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instantMs / 1000) * 1000;
  };
  // Try both offsets around the moment; the earlier valid instant wins for ambiguous times.
  const candidates = new Set([asUtc - offsetAt(asUtc - 86_400_000), asUtc - offsetAt(asUtc + 86_400_000)]);
  const valid = [...candidates].filter((ms) => offsetAt(ms) === asUtc - ms).sort((a, b) => a - b);
  if (valid.length) return new Date(valid[0]);
  // Skipped local time: shift forward by the gap.
  return new Date(asUtc - offsetAt(asUtc - 86_400_000));
}
/** Weight is a calendar-day value, stored as noon UTC of that date: the stamp never crosses a day boundary in any zone offset arithmetic. */
export function weightDateToStamp(date: string): Date { return new Date(`${date}T12:00:00Z`); }
export function weightStampToDate(stamp: Date | string): string { return new Date(stamp).toISOString().slice(0, 10); }
export function parseMinor(value: string): number {
  // Spaces between digit groups (also the non-breaking ones the app itself prints) are allowed: «5 913,34».
  const normalized = value.replace(/[\s\u00a0\u202f]/g, "").replace(",", ".");
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(normalized)) throw new Error("Введи сумму числом, например 1500,50.");
  const [whole, decimal = ""] = normalized.split(".");
  return Number(BigInt(whole) * 100n + BigInt(decimal.padEnd(2, "0")));
}
/**
 * Converts an amount to the owner's base currency. Amounts already in the base currency stay as they are;
 * any other currency needs the manual rate (units of base per one unit of `currency`) captured for it.
 */
export function convertToBaseMinor(amountMinor: number, currency: string, baseCurrency: string, rate: string | null): number {
  if (currency === baseCurrency) return amountMinor;
  if (!rate || !/^\d+(\.\d{1,10})?$/.test(rate) || Number(rate) <= 0) throw new Error(`Для валюты ${currency} нужен ручной курс.`);
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
