import { parseMinor } from "./math";

export type FinancePlanInput = {
  name: string;
  amountMinor: number;
};

const wordStart = "(?<![\\p{L}\\p{N}_])";

/** Parse the explicit Telegram marker `план <название> <сумма>`. */
export function parseFinancePlanMessage(text: string): FinancePlanInput | null {
  if (!/^\s*план(?=$|[\s:,-])/iu.test(text)) return null;
  const cleaned = text.trim().replace(/^план[\s:,-]*/iu, "");
  const amountMatch = /(?:^|\s)((?:\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d{1,10})(?:[.,]\d{1,2})?)(?:\s*(?:р\.?|руб(?:ль|ля|лей)?|₽))?\s*$/iu.exec(cleaned);
  if (!amountMatch) return null;

  let name = cleaned.slice(0, amountMatch.index).trim();
  name = name.replace(new RegExp(`${wordStart}(?:на|в)\\s*$`, "iu"), "").replace(/^план[\s:,-]*/iu, "").trim();
  if (!name) return null;

  let amountMinor: number;
  try {
    amountMinor = parseMinor(amountMatch[1].replace(/[ \u00a0\u202f]/gu, ""));
  } catch {
    return null;
  }
  if (amountMinor <= 0 || amountMinor > 1_000_000_000_000) return null;

  return { name: name.slice(0, 300), amountMinor };
}
