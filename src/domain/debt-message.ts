import { parseMinor } from "./math";

export type DebtMessageIntent =
  | {
      kind: "create";
      personName: string;
      direction: "i_owe" | "owed_to_me";
      amountMinor: number;
      openedAs: "transfer" | "opening_balance";
      dueOn: string | null;
      note: string | null;
    }
  | {
      kind: "repayment";
      personName: string;
      direction: "i_owe" | "owed_to_me" | null;
      amountMinor: number;
    };

const groupedInteger = String.raw`(?:\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d{1,10})`;
const amountToken = String.raw`${groupedInteger}(?:[.,]\d{1,2})?(?:\s*(?:р\.?|руб(?:ль|ля|лей)?\.?|₽))?`;
const amountAtEnd = new RegExp(
  String.raw`(?:^|\s)(?<amount>${amountToken})\s*[.!?…]*$`,
  "iu",
);
const openingMarker = /^(?:(?:старый\s+долг|остаток\s+долга|добавь\s+(?:старый\s+)?долг)\s*[:,—–-]?\s*)+/iu;
const amountBeforeLender = new RegExp(
  String.raw`^(?:я\s+)?(?:занял(?:а|и|о)?|одолжил(?:а|и|о)?)\s+(?<amount>${amountToken})\s+у\s+(?<person>.+?)\s*[.!?…]*$`,
  "iu",
);

const MAX_AMOUNT_MINOR = 1_000_000_000_000;
const MAX_PERSON_NAME_LENGTH = 120;

function parsePositiveAmount(value: string): number | null {
  const numeric = value
    .replace(/\s*(?:р\.?|руб(?:ль|ля|лей)?\.?|₽)$/iu, "")
    .replace(/[ \u00a0\u202f]/gu, "");

  try {
    const amountMinor = parseMinor(numeric);
    return Number.isSafeInteger(amountMinor) && amountMinor > 0 && amountMinor <= MAX_AMOUNT_MINOR
      ? amountMinor
      : null;
  } catch {
    return null;
  }
}

function extractEndingAmount(text: string): { before: string; amountMinor: number } | null {
  const match = amountAtEnd.exec(text);
  const amount = match?.groups?.amount;
  if (match?.index === undefined || !amount) return null;

  const amountMinor = parsePositiveAmount(amount);
  if (amountMinor === null) return null;

  return { before: text.slice(0, match.index).trim(), amountMinor };
}

function cleanPersonName(value: string): string | null {
  const name = value.trim().replace(/^[\s,:;—–-]+|[\s,:;—–.!?]+$/gu, "").trim();
  if (
    name.length < 2 ||
    name.length > MAX_PERSON_NAME_LENGTH ||
    !/\p{L}/u.test(name) ||
    /^(?:за|на|в|из|для|по|от|с|до)\b/iu.test(name)
  ) {
    return null;
  }
  return name;
}

function createIntent(
  personName: string,
  direction: "i_owe" | "owed_to_me",
  amountMinor: number,
  openedAs: "transfer" | "opening_balance",
): DebtMessageIntent | null {
  const cleanedName = cleanPersonName(personName);
  if (!cleanedName) return null;
  return {
    kind: "create",
    personName: cleanedName,
    direction,
    amountMinor,
    openedAs,
    dueOn: null,
    note: null,
  };
}

function parseRepayment(text: string): DebtMessageIntent | null {
  const extracted = extractEndingAmount(text);
  if (!extracted) return null;

  const outgoing = /^(?:я\s+)?вернул(?:а|и|о)?\s+(.+)$/iu.exec(extracted.before);
  if (outgoing) {
    const personName = cleanPersonName(outgoing[1]);
    return personName
      ? { kind: "repayment", personName, direction: "i_owe", amountMinor: extracted.amountMinor }
      : null;
  }

  const incoming = /^(.+?)\s+вернул(?:а|и|о)?(?:\s+мне)?$/iu.exec(extracted.before);
  if (incoming) {
    const personName = cleanPersonName(incoming[1]);
    return personName
      ? { kind: "repayment", personName, direction: "owed_to_me", amountMinor: extracted.amountMinor }
      : null;
  }

  return null;
}

/** Parse explicit Russian debt creation or repayment messages with amounts in PRB. */
export function parseDebtMessage(text: string): DebtMessageIntent | null {
  const normalized = text.trim().replace(/\s+/gu, " ");
  if (!normalized) return null;

  const repayment = parseRepayment(normalized);
  if (repayment) return repayment;

  const openingMatch = openingMarker.exec(normalized);
  const openedAs = openingMatch ? "opening_balance" : "transfer";
  const createText = openingMatch ? normalized.slice(openingMatch[0].length).trim() : normalized;
  if (!createText) return null;

  const borrowed = amountBeforeLender.exec(createText);
  if (borrowed?.groups?.amount && borrowed.groups.person) {
    const amountMinor = parsePositiveAmount(borrowed.groups.amount);
    if (amountMinor === null) return null;
    return createIntent(borrowed.groups.person, "i_owe", amountMinor, openedAs);
  }

  const extracted = extractEndingAmount(createText);
  if (!extracted) return null;

  const owesMe = /^(.+?)\s+долж(?:ен|на|но|ны)?\s+мне$/iu.exec(extracted.before);
  if (owesMe) return createIntent(owesMe[1], "owed_to_me", extracted.amountMinor, openedAs);

  const iOwe = /^(?:я\s+)?долж(?:ен|на|ны)?\s+(.+)$/iu.exec(extracted.before);
  if (iOwe) return createIntent(iOwe[1], "i_owe", extracted.amountMinor, openedAs);

  const lent = /^(?:я\s+)?одолжил(?:а|и|о)?\s+(.+)$/iu.exec(extracted.before);
  if (lent) return createIntent(lent[1], "owed_to_me", extracted.amountMinor, openedAs);

  return null;
}
