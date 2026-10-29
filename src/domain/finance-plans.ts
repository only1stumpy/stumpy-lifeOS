import { parseMinor } from "./math";

export type FinancePlanInput = {
  name: string;
  amountMinor: number;
  targetMonth: string;
};

const monthRoots: readonly [RegExp, number][] = [
  [/январ\p{L}*/iu, 1], [/феврал\p{L}*/iu, 2], [/март\p{L}*/iu, 3],
  [/апрел\p{L}*/iu, 4], [/(?:май|мая|мае)\p{L}*/iu, 5], [/июн\p{L}*/iu, 6],
  [/июл\p{L}*/iu, 7], [/август\p{L}*/iu, 8], [/сентябр\p{L}*/iu, 9],
  [/октябр\p{L}*/iu, 10], [/ноябр\p{L}*/iu, 11], [/декабр\p{L}*/iu, 12],
];

const wordStart = "(?<![\\p{L}\\p{N}_])";
const wordEnd = "(?![\\p{L}\\p{N}_])";

function formatMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

function shiftMonth(value: string, offset: number): string {
  const [year, month] = value.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + offset, 1));
  return formatMonth(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1);
}

function targetMonthFromText(body: string, localDate: string): string {
  const numeric = body.match(/\b(20\d{2})[-/.](0?[1-9]|1[0-2])\b/u);
  if (numeric) return formatMonth(Number(numeric[1]), Number(numeric[2]));

  if (new RegExp(`${wordStart}(?:этот|текущий|этом|текущем)\\s+месяц(?:е)?${wordEnd}`, "iu").test(body)) {
    return formatMonth(Number(localDate.slice(0, 4)), Number(localDate.slice(5, 7)));
  }
  if (new RegExp(`${wordStart}следующ(?:ий|ем)\\s+месяц(?:е)?${wordEnd}`, "iu").test(body)) return shiftMonth(localDate, 1);

  for (const [pattern, month] of monthRoots) {
    const match = body.match(new RegExp(`${wordStart}(?:${pattern.source})(?:\\s+(20\\d{2}))?${wordEnd}`, "iu"));
    if (!match) continue;
    const year = match[1] ? Number(match[1]) : month >= Number(localDate.slice(5, 7)) ? Number(localDate.slice(0, 4)) : Number(localDate.slice(0, 4)) + 1;
    return formatMonth(year, month);
  }

  return shiftMonth(localDate, 1);
}

function removeScheduleText(value: string): string {
  const monthPattern = "январ\\p{L}*|феврал\\p{L}*|март\\p{L}*|апрел\\p{L}*|май|мая|мае|июн\\p{L}*|июл\\p{L}*|август\\p{L}*|сентябр\\p{L}*|октябр\\p{L}*|ноябр\\p{L}*|декабр\\p{L}*";
  return value
    .replace(new RegExp(`${wordStart}после\\s+зарплаты${wordEnd}`, "giu"), " ")
    .replace(new RegExp(`${wordStart}в\\s+план${wordEnd}`, "giu"), " ")
    .replace(new RegExp(`${wordStart}(?:на|в)\\s+(?:следующ(?:ий|ем)|этот|текущий)\\s+месяц(?:е)?${wordEnd}`, "giu"), " ")
    .replace(new RegExp(`${wordStart}(?:на|в)\\s+(?:${monthPattern})(?:\\s+20\\d{2})?${wordEnd}`, "giu"), " ")
    .replace(/\b20\d{2}[-/.](?:0?[1-9]|1[0-2])\b/gu, " ")
    .replace(new RegExp(`${wordStart}(?:следующ(?:ий|ем)|этот|текущий)\\s+месяц(?:е)?${wordEnd}`, "giu"), " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Parse the explicit Telegram marker `план <название> <сумма> [месяц]`. */
export function parseFinancePlanMessage(text: string, localDate: string): FinancePlanInput | null {
  if (!/^\s*план(?=$|[\s:,-])/iu.test(text)) return null;
  const body = text.trim().replace(/^план[\s:,-]*/iu, "");
  const targetMonth = targetMonthFromText(body, localDate);
  const cleaned = removeScheduleText(body);
  const amountMatch = /(?:^|\s)(\d{1,10}(?:[.,]\d{1,2})?)(?:\s*(?:р\.?|руб(?:ль|ля|лей)?|₽))?\s*$/iu.exec(cleaned);
  if (!amountMatch) return null;

  let name = cleaned.slice(0, amountMatch.index).trim();
  name = name.replace(new RegExp(`${wordStart}(?:на|в)\\s*$`, "iu"), "").replace(/^план[\s:,-]*/iu, "").trim();
  if (!name) return null;

  let amountMinor: number;
  try {
    amountMinor = parseMinor(amountMatch[1]);
  } catch {
    return null;
  }
  if (amountMinor <= 0 || amountMinor > 1_000_000_000_000) return null;

  return { name: name.slice(0, 300), amountMinor, targetMonth };
}
