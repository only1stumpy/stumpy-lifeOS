const WEIGHT_MESSAGE = /^(?:(?:мой\s+)?вес(?:\s+сегодня)?|вешу|взвесил(?:ся|ась))?\s*[:=—–-]?\s*(\d{2,3}(?:[.,]\d{1,2})?)\s*(кг|кило(?:грамм?(?:а|ов)?)?|kg)?\.?$/i;

/**
 * Recognizes a short body-weight message such as «вес 60», «60 кг», «вешу 72,4 кг».
 * A bare number is ignored: it needs either a weight word or a unit.
 */
export function parseWeightMessage(text: string): number | null {
  const normalized = text.trim().replace(/\s+/g, " ");
  const match = WEIGHT_MESSAGE.exec(normalized);
  if (!match) return null;
  const hasWord = /^\D/.test(normalized);
  if (!hasWord && !match[2]) return null;
  const weightKg = Number(match[1].replace(",", "."));
  return weightKg >= 30 && weightKg <= 350 ? weightKg : null;
}
