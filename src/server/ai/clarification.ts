import { rubleMarkerContradictsBase } from "@/domain/currencies";
import type { AnalysisMoney, ClarificationMessage } from "./types";

export const CLARIFICATION_TTL_MS = 30 * 60 * 1_000;
const MAX_HISTORY_MESSAGES = 10;
const MAX_HISTORY_MESSAGE_LENGTH = 1_200;

export type MoneyClarificationResolution = { type: "resolved"; money: AnalysisMoney };

/** Return a clean, owner-scoped clarification history only while its TTL is valid. */
export function activeClarificationHistory(
  messages: unknown,
  updatedAt: Date | null,
  now: Date,
): ClarificationMessage[] | null {
  if (!updatedAt || now.getTime() - updatedAt.getTime() > CLARIFICATION_TTL_MS || updatedAt > now) {
    return null;
  }
  return normalizeClarificationHistory(messages);
}

/** Keep only bounded plain-text turns; images and arbitrary payload fields never enter storage. */
export function normalizeClarificationHistory(value: unknown): ClarificationMessage[] | null {
  if (!Array.isArray(value)) return null;
  const messages = value.flatMap((item): ClarificationMessage[] => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    if ((record.role !== "user" && record.role !== "assistant") || typeof record.text !== "string") return [];
    const text = record.text.trim().slice(0, MAX_HISTORY_MESSAGE_LENGTH);
    return text ? [{ role: record.role, text }] : [];
  });
  if (!messages.length) return null;
  return boundHistory(messages);
}

/** Add a new clarification turn, preserving the original event and the latest replies. */
export function appendClarificationTurn(
  history: ClarificationMessage[] | null,
  userText: string,
  assistantQuestion: string,
): ClarificationMessage[] {
  const messages = [...(history ?? [])];
  const userMessage = normalizeMessage("user", userText);
  const question = normalizeMessage("assistant", assistantQuestion);
  if (userMessage) messages.push(userMessage);
  if (question) messages.push(question);
  return boundHistory(messages);
}

/** Draft creation ends the unresolved clarification chain. */
export function nextClarificationHistory(
  history: ClarificationMessage[] | null,
  userText: string,
  assistantQuestion: string | null,
  hasDrafts: boolean,
): ClarificationMessage[] | null {
  if (hasDrafts || !assistantQuestion) return null;
  return appendClarificationTurn(history, userText, assistantQuestion);
}

/**
 * Resolve the narrow balance-vs-transaction clarification flow without sending
 * already-known amounts back to the model. The source amount is trusted only
 * when it appears in the user message immediately preceding an assistant
 * balance/operation question and that message itself refers to an account.
 */
export function resolveMoneyClarification(
  text: string,
  history: ClarificationMessage[] | undefined,
  defaultCurrency = "USD",
): MoneyClarificationResolution | null {
  if (!history?.length) return null;

  const source = findBalanceQuestion(history, defaultCurrency);
  if (!source) return null;

  if (source.questionIndex === history.length - 1) {
    const kind = parseOperationKind(text);
    return kind ? resolvedMoney(source, kind, inferBalanceCategory(source.sourceText, kind)) : null;
  }

  const kindAnswer = history[source.questionIndex + 1];
  const categoryQuestion = history[source.questionIndex + 2];
  if (
    kindAnswer?.role !== "user" ||
    categoryQuestion?.role !== "assistant"
  ) {
    return null;
  }

  const kind = parseOperationKind(kindAnswer.text);
  if (!kind) return null;

  const categoryQuestionText = categoryQuestion.text.toLocaleLowerCase("ru-RU");
  if (categoryQuestion === history.at(-1) && categoryQuestionText.includes("категори")) {
    const category = parseCategoryAnswer(text);
    return category ? resolvedMoney(source, kind, category) : null;
  }

  // Recover a legacy chain where the category was already sent, but the model
  // then asked for an amount that was present in the original balance message.
  const categoryAnswer = history[source.questionIndex + 3];
  const amountQuestion = history[source.questionIndex + 4];
  if (
    amountQuestion?.role !== "assistant" ||
    amountQuestion !== history.at(-1) ||
    !categoryQuestionText.includes("категори") ||
    !amountQuestion.text.toLocaleLowerCase("ru-RU").includes("сумм") ||
    amountQuestion.text.toLocaleLowerCase("ru-RU").includes("категори") ||
    categoryAnswer?.role !== "user"
  ) {
    return null;
  }

  const previousCategory = parseCategoryAnswer(categoryAnswer.text);
  if (!previousCategory || normalizeShortAnswer(previousCategory) !== normalizeShortAnswer(text)) {
    return null;
  }
  return resolvedMoney(source, kind, previousCategory);
}

type BalanceQuestionContext = {
  questionIndex: number;
  sourceText: string;
  amountMinor: number;
  currency: string;
};

function findBalanceQuestion(history: ClarificationMessage[], defaultCurrency: string): BalanceQuestionContext | null {
  for (let questionIndex = history.length - 1; questionIndex > 0; questionIndex -= 1) {
    const question = history[questionIndex];
    const source = history[questionIndex - 1];
    if (source?.role !== "user" || question?.role !== "assistant") continue;

    const assistantText = question.text.toLocaleLowerCase("ru-RU");
    const asksBalanceVsOperation =
      /(баланс|остаток)/iu.test(assistantText) && /(доход|расход)/iu.test(assistantText);
    const sourceMentionsAccount = /(?:на\s+(?:мо[её]м\s+)?сч[её]т(?:у|е)?|баланс|остат)/iu.test(source.text);
    const amount = parseExplicitMoneyAmount(source.text, defaultCurrency);
    if (asksBalanceVsOperation && sourceMentionsAccount && amount) {
      return { questionIndex, sourceText: source.text, ...amount };
    }
  }
  return null;
}

function resolvedMoney(
  source: BalanceQuestionContext,
  kind: "income" | "expense",
  category: string,
): MoneyClarificationResolution {
  return {
    type: "resolved",
    money: {
      label: capitalizeCategory(category),
      amountMinor: source.amountMinor,
      currency: source.currency,
      kind,
      category,
    },
  };
}

function inferBalanceCategory(text: string, kind: "income" | "expense"): string {
  const normalized = text.toLocaleLowerCase("ru-RU");
  if (kind === "income" && /зарплат|оклад|аванс|преми/iu.test(normalized)) return "Зарплата";
  if (kind === "expense") {
    if (/маршрут|автобус|троллейбус|трамва|метро|такси|проезд/iu.test(normalized)) return "Транспорт";
    if (/бензин|дизел|топлив|заправ|автосервис|автомобил/iu.test(normalized)) return "Авто";
    if (/продукт|покупк.{0,12}магазин/iu.test(normalized)) return "Продукты";
    if (/кафе|ресторан|столов|доставк|суши|ролл|пицц|шаурм|кофе/iu.test(normalized)) return "Кафе и рестораны";
    if (/обед|ужин|завтрак|еда|питани|блюдо|суп|лапш|удон/iu.test(normalized)) return "Еда";
    if (/подпис|spotify|chatgpt|netflix|youtube\s*premium/iu.test(normalized)) return "Подписки";
  }
  return "Прочее";
}

function parseOperationKind(value: string): "income" | "expense" | null {
  const normalized = normalizeShortAnswer(value);
  if (["доход", "доходы", "поступление", "зачисление"].includes(normalized)) return "income";
  if (["расход", "расходы", "трата", "траты", "списание"].includes(normalized)) return "expense";
  return null;
}

function parseCategoryAnswer(value: string): string | null {
  const answer = value.trim().replace(/^[\s.,!?;:]+|[\s.,!?;:]+$/gu, "");
  if (answer.length === 0 || answer.length > 80 || /\d|[$€₽]/u.test(answer)) return null;
  if (parseOperationKind(answer)) return null;
  if (/(?:USD|доллар|долл\.?|руб(?:ль|ля|лей)?|(?<![\p{L}])PRB(?![\p{L}]))/iu.test(answer)) return null;
  if (/(?:съел|съела|съели|потратил|потратила|купил|купила|получил|получила|на счет|на счёт|баланс|остаток)/iu.test(answer)) return null;
  const words = answer.split(/\s+/u);
  if (words.length > 4) return null;
  return answer;
}

function parseExplicitMoneyAmount(
  value: string,
  defaultCurrency: string,
): { amountMinor: number; currency: string } | null {
  const number = String.raw`(?:\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d+)(?:[.,]\d{1,2})?`;
  const beforeCurrency = String.raw`(?:\$|USD|доллар(?:а|ов)?|долл\.?)`;
  const afterCurrency = String.raw`(?:USD|доллар(?:а|ов)?|долл\.?|руб(?:ль|ля|лей)?\.?|р\.?)`;
  const pattern = new RegExp(
    `(?:(${beforeCurrency})\\s*(${number})|(?<![\\p{L}\\d])(${number})\\s*(${afterCurrency})(?![\\p{L}]))`,
    "giu",
  );
  const matches = [...value.matchAll(pattern)];
  if (matches.length !== 1) return null;

  const match = matches[0]!;
  const rawCurrency = match[1] ?? match[4];
  const rawAmount = match[2] ?? match[3];
  if (!rawCurrency || !rawAmount) return null;

  const normalizedAmount = rawAmount.replace(/[ \u00a0\u202f]/gu, "").replace(",", ".");
  const [wholePart, fractionPart = ""] = normalizedAmount.split(".");
  try {
    const minor = BigInt(wholePart!) * 100n + BigInt((fractionPart + "00").slice(0, 2));
    if (minor <= 0n || minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    const dollars = /(?:\$|USD|доллар|долл)/iu.test(rawCurrency);
    // «руб.» is taken for the base currency only when that currency is a ruble; otherwise let the model ask.
    if (!dollars && rubleMarkerContradictsBase(`0 ${rawCurrency}`, defaultCurrency)) return null;
    const currency = dollars ? "USD" : defaultCurrency;
    return { amountMinor: Number(minor), currency };
  } catch {
    return null;
  }
}

function normalizeShortAnswer(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/gu, "е")
    .replace(/\s+/gu, " ")
    .replace(/^[\s.,!?;:]+|[\s.,!?;:]+$/gu, "");
}

function capitalizeCategory(value: string): string {
  const first = value.slice(0, 1).toLocaleUpperCase("ru-RU");
  return `${first}${value.slice(1)}`;
}

function normalizeMessage(role: ClarificationMessage["role"], value: string): ClarificationMessage | null {
  const text = value.trim().slice(0, MAX_HISTORY_MESSAGE_LENGTH);
  return text ? { role, text } : null;
}

function boundHistory(messages: ClarificationMessage[]): ClarificationMessage[] {
  if (messages.length <= MAX_HISTORY_MESSAGES) return messages;
  const originalIndex = messages.findIndex((message) => message.role === "user");
  if (originalIndex < 0) return messages.slice(-MAX_HISTORY_MESSAGES);
  const original = messages[originalIndex]!;
  const remaining = [
    ...messages.slice(0, originalIndex),
    ...messages.slice(originalIndex + 1),
  ].slice(-(MAX_HISTORY_MESSAGES - 1));
  return [original, ...remaining];
}
