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
  { code: "PRB", name: "Рубль ПМР", unit: "р. ПМР" },
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

function infoFor(code: CurrencyCode): CurrencyInfo | undefined {
  return COMMON_CURRENCIES.find((item) => item.code === code);
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

/** Currencies that a bare «руб.», «р.» or «₽» can mean without asking. */
const RUBLE_CURRENCIES: readonly CurrencyCode[] = ["RUB", "PRB"];

export const RUBLE_MARKER = /(?:\d\s*(?:р\.?|руб[\p{L}]*\.?)|₽)(?![\p{L}])/iu;

/** True when the text names rubles explicitly while the owner's base currency is something else: ask, do not assume. */
export function rubleMarkerContradictsBase(text: string, baseCurrency: CurrencyCode | null): boolean {
  return baseCurrency !== null && !RUBLE_CURRENCIES.includes(baseCurrency) && RUBLE_MARKER.test(text);
}

/** Words that name a specific ruble, so the model's pick must not be overridden. */
const EXPLICIT_RUBLE = /российск|приднестровск|(?<![\p{L}])(?:RUB|PRB|ПМР)(?![\p{L}])/iu;

/**
 * A bare «руб.»/«р.»/₽ means the owner's own ruble when the base currency is RUB or PRB; the model often
 * answers RUB for either. An explicit «российских», «RUB» or «PRB» in the text keeps the model's code.
 */
export function anchorRubleToBase(text: string, modelCurrency: CurrencyCode, baseCurrency: CurrencyCode | null): CurrencyCode {
  if (baseCurrency === null || modelCurrency === baseCurrency) return modelCurrency;
  if (!RUBLE_CURRENCIES.includes(baseCurrency) || !RUBLE_CURRENCIES.includes(modelCurrency)) return modelCurrency;
  return RUBLE_MARKER.test(text) && !EXPLICIT_RUBLE.test(text) ? baseCurrency : modelCurrency;
}

/** Chat question for a message whose explicit currency differs from the base one. */
export function foreignCurrencyQuestion(baseCurrency: CurrencyCode): string {
  return `В сообщении указаны рубли, а твоя основная валюта — ${baseCurrency}. Напиши сумму без валюты (она запишется в ${baseCurrency}) или добавь операцию в нужной валюте в LifeOS.`;
}
