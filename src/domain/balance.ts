import { convertToBaseMinor, parseMinor } from "./math";
import { formatMoneyPlain } from "./currencies";

export type BalanceAccount = { id: string; name: string; currency: string; balanceMinor: number; openingBalanceMinor: number; isDefault?: boolean };

/** Rates are units of base currency per one unit of the account currency (the latest manual rate). */
export function totalInBaseMinor(accounts: readonly BalanceAccount[], baseCurrency: string, rates: Readonly<Record<string, string>>): number | null {
  let total = 0;
  for (const account of accounts) {
    try {
      total += convertToBaseMinor(account.balanceMinor, account.currency, baseCurrency, rates[account.currency] ?? null);
    } catch {
      return null; // a currency without a manual rate: an honest "no total" beats a wrong one
    }
  }
  return total;
}

/** «Остаток на «Карта»: 1 200 руб. ПМР» plus, with several accounts, the overall total in the base currency. */
export function formatBalanceLines(
  accounts: readonly BalanceAccount[],
  touchedIds: readonly string[],
  baseCurrency: string,
  rates: Readonly<Record<string, string>>,
): string[] {
  const touched = touchedIds
    .map((id) => accounts.find((account) => account.id === id))
    .filter((account, index, list): account is BalanceAccount => !!account && list.indexOf(account) === index);
  if (!touched.length) return [];
  const lines = touched.map((account) => `Остаток на «${account.name}»: ${formatMoneyPlain(account.balanceMinor, account.currency)}`);
  if (accounts.length > 1) {
    const total = totalInBaseMinor(accounts, baseCurrency, rates);
    lines.push(total === null
      ? "Общий итог не посчитать: для какой-то валюты не задан курс."
      : `Всего по счетам: ${formatMoneyPlain(total, baseCurrency)}`);
  }
  return lines;
}

/** The opening balance that makes the account show `targetMinor` now, keeping every recorded operation as it is. */
export function openingBalanceFor(targetMinor: number, account: Pick<BalanceAccount, "balanceMinor" | "openingBalanceMinor">): number {
  return targetMinor - (account.balanceMinor - account.openingBalanceMinor);
}

const MAX_BALANCE_MINOR = 1_000_000_000_000;
const setBalanceVerb = /^(?:поставь|поставьте|установи|установите|задай|задайте|измени|поменяй|поправь|исправь|обнови|сделай)\s+(?:мне\s+)?(?:(?:текущий|новый)\s+)?(?:баланс|остаток)(?=\s|$)\s*(?:на\s+)?(?:счет[а-я]*\s+|счёт[а-я]*\s+)?/iu;
const amountAtEnd = /(?:^|\s)(?<amount>-?(?:\d{1,3}(?:[   ]\d{3})+|\d+)(?:[.,]\d{1,2})?)\s*(?<unit>тыс(?:яч[а-я]*)?\.?|к|k)?(?:\s*(?:р\.?|руб(?:ль|ля|лей)?\.?|₽|[a-z]{3,5}))?\s*[.!?…]*$/iu;

export type SetBalanceIntent = { accountQuery: string; targetMinor: number };

/** «поставь баланс карты 5000» → {accountQuery: "карты", targetMinor: 500000}; null when the text is not such a command. */
export function parseSetBalanceMessage(text: string): SetBalanceIntent | null {
  const trimmed = text.trim();
  const verb = setBalanceVerb.exec(trimmed);
  if (!verb) return null;
  const rest = trimmed.slice(verb[0].length);
  const match = amountAtEnd.exec(rest);
  const amount = match?.groups?.amount;
  if (match?.index === undefined || !amount) return null;
  const numeric = amount.replace(/[   ]/gu, "");
  let targetMinor: number;
  try {
    const negative = numeric.startsWith("-");
    targetMinor = parseMinor(negative ? numeric.slice(1) : numeric);
    if (negative) targetMinor = -targetMinor;
  } catch {
    return null;
  }
  if (match.groups?.unit) targetMinor *= 1000;
  if (!Number.isSafeInteger(targetMinor) || Math.abs(targetMinor) > MAX_BALANCE_MINOR) return null;
  const accountQuery = rest.slice(0, match.index).trim().replace(/^(?:на|для|по)\s+/iu, "").replace(/[\s,:;—–-]+$/u, "");
  return { accountQuery, targetMinor };
}

const normalize = (value: string) => value.toLocaleLowerCase("ru-RU").replaceAll("ё", "е").trim();
const stem = (word: string) => (word.length > 4 ? word.slice(0, -1) : word);

export type AccountMatch =
  | { kind: "found"; account: BalanceAccount }
  | { kind: "ambiguous"; accounts: BalanceAccount[] }
  | { kind: "none" };

/** By name: an exact name wins, then names that contain or are contained in the query (case endings tolerated). */
export function matchAccountByName(accounts: readonly BalanceAccount[], query: string): AccountMatch {
  if (!accounts.length) return { kind: "none" };
  const q = normalize(query);
  if (!q) return accounts.length === 1 ? { kind: "found", account: accounts[0] } : { kind: "ambiguous", accounts: [...accounts] };
  const exact = accounts.filter((account) => normalize(account.name) === q);
  if (exact.length === 1) return { kind: "found", account: exact[0] };
  const words = q.split(/\s+/u).map(stem);
  const loose = accounts.filter((account) => {
    const name = normalize(account.name);
    return name.includes(q) || words.every((word) => name.includes(word));
  });
  if (loose.length === 1) return { kind: "found", account: loose[0] };
  if (loose.length > 1) return { kind: "ambiguous", accounts: loose };
  return { kind: "none" };
}
