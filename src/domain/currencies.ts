import { z } from "zod";
import { formatMoneyAmount } from "./math";

/**
 * A currency code: 3–5 uppercase Latin letters. ISO 4217 codes work, and so do custom ones such as PRB
 * (Transnistrian ruble, which has no ISO code). Amounts are always kept with two decimals.
 */
export type CurrencyCode = string;

const CODE_PATTERN = /^[A-Z]{3,5}$/;

export const currencyCodeSchema = z.string().trim().toUpperCase().regex(CODE_PATTERN, "Код валюты: от 3 до 5 латинских букв.");

/** Uppercased code, or null when it is not a valid currency code. */
export function normalizeCurrencyCode(value: string): CurrencyCode | null {
  const code = value.trim().toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}

type CurrencyInfo = { code: CurrencyCode; name: string; unit: string };

/** Offered in pickers. Currencies without two decimal places (JPY, KWD...) are left out on purpose. */
export const COMMON_CURRENCIES: readonly CurrencyInfo[] = [
  { code: "USD", name: "Доллар США", unit: "$" },
  { code: "EUR", name: "Евро", unit: "€" },
  { code: "RUB", name: "Российский рубль", unit: "₽" },
  { code: "MDL", name: "Молдавский лей", unit: "лей" },
  { code: "UAH", name: "Украинская гривна", unit: "₴" },
  { code: "BYN", name: "Белорусский рубль", unit: "Br" },
  { code: "KZT", name: "Казахстанский тенге", unit: "₸" },
  { code: "PLN", name: "Польский злотый", unit: "zł" },
  { code: "GBP", name: "Британский фунт", unit: "£" },
  { code: "CHF", name: "Швейцарский франк", unit: "CHF" },
  { code: "CZK", name: "Чешская крона", unit: "Kč" },
  { code: "GEL", name: "Грузинский лари", unit: "₾" },
  { code: "AMD", name: "Армянский драм", unit: "֏" },
  { code: "TRY", name: "Турецкая лира", unit: "₺" },
  { code: "CNY", name: "Китайский юань", unit: "¥" },
  { code: "AED", name: "Дирхам ОАЭ", unit: "AED" },
];

/** Known but not listed in pickers: the Transnistrian ruble used before currencies became configurable. */
const EXTRA_CURRENCIES: readonly CurrencyInfo[] = [{ code: "PRB", name: "Рубль ПМР", unit: "р. ПМР" }];

function infoFor(code: CurrencyCode): CurrencyInfo | undefined {
  return COMMON_CURRENCIES.find((item) => item.code === code) ?? EXTRA_CURRENCIES.find((item) => item.code === code);
}

/** Short suffix for amounts: «$», «€», «р. ПМР», or the code itself for unknown currencies. */
export function currencyUnit(code: CurrencyCode): string {
  return infoFor(code)?.unit ?? code;
}

/** Human-readable name, or the code when the currency is custom. */
export function currencyName(code: CurrencyCode): string {
  return infoFor(code)?.name ?? code;
}

/** «1 234,56 $» — an amount in minor units with its currency suffix. */
export function formatMoney(amountMinor: number, code: CurrencyCode): string {
  return `${formatMoneyAmount(amountMinor)} ${currencyUnit(code)}`;
}

const plainAmount = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Chat form with two decimals and an unambiguous suffix: «85,00 руб. ПМР», «10,00 USD». */
export function formatMoneyPlain(amountMinor: number, code: CurrencyCode): string {
  return `${plainAmount.format(amountMinor / 100)} ${code === "PRB" ? "руб. ПМР" : code}`;
}
