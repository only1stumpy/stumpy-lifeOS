import type { ClarificationMessage } from "./types";

export const CLARIFICATION_TTL_MS = 30 * 60 * 1_000;
const MAX_HISTORY_MESSAGES = 10;
const MAX_HISTORY_MESSAGE_LENGTH = 1_200;

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
