import { raiseAlert } from "@/server/admin/alerts";
import type { AIAnalysisErrorCode, AIAttempt } from "./types";

export type AiErrorTask = "food" | "reference";

/** What the user does next, per failure code. Mini App works without AI, so manual input is always offered for records. */
const ACTIONS: Record<AIAnalysisErrorCode, string> = {
  invalid_input: "Сократи сообщение или уменьши фото.",
  not_configured: "Подключи ключ в настройках: «ИИ-провайдеры».",
  provider_failed: "Попробуй ещё раз чуть позже.",
  provider_mixed: "Попробуй ещё раз чуть позже или проверь ключи и модели в «ИИ-провайдерах».",
  provider_unavailable: "Попробуй ещё раз через несколько минут.",
  provider_configuration: "Проверь ключ в «ИИ-провайдерах» или выбери другую модель.",
  quota_exceeded: "Бесплатный лимит исчерпан: повтори позже или добавь другой ключ в «ИИ-провайдерах».",
  credits_exhausted: "На аккаунте провайдера закончились кредиты: пополни их или добавь другой ключ в «ИИ-провайдерах».",
  invalid_response: "Напиши сообщение ещё раз.",
  time_budget: "Отправь сообщение ещё раз чуть позже.",
};

const REASONS: Record<AIAnalysisErrorCode, string> = {
  invalid_input: "Сообщение или фото не подходит для разбора.",
  not_configured: "ИИ не подключён.",
  provider_failed: "Не получилось обратиться к ИИ.",
  provider_mixed: "ИИ-провайдеры не ответили по разным причинам.",
  provider_unavailable: "ИИ сейчас не отвечает.",
  provider_configuration: "Ключ или модель не подошли: проверь ключ, права доступа и название модели.",
  quota_exceeded: "Лимит запросов к ИИ исчерпан.",
  credits_exhausted: "Кредиты провайдера закончились.",
  invalid_response: "ИИ вернул неразборчивый ответ.",
  time_budget: "ИИ не ответил вовремя.",
};

const MANUAL = " Ничего не записано: можно внести данные вручную в Mini App, он работает без ИИ.";

/** Plain text for the chat and the Mini App: reason, one action, and the manual fallback for records. */
export function aiErrorUserMessage(code: AIAnalysisErrorCode, task: AiErrorTask = "food"): string {
  const manual = task === "food" && code !== "invalid_input" && code !== "not_configured" ? MANUAL : "";
  return `${REASONS[code]} ${ACTIONS[code]}${manual}`;
}

const PROVIDER_NAMES: Record<string, string> = { gemini: "Gemini", groq: "Groq", "openai-compatible": "OpenAI-compatible" };

/** Admin-bot text: code, each failed attempt (provider, model, HTTP status, kind). No keys, prompts or user text. */
export function aiErrorAdminText(code: AIAnalysisErrorCode, attempts: readonly AIAttempt[]): string {
  const lines = attempts.slice(0, 6).map((attempt) => {
    const name = PROVIDER_NAMES[attempt.provider] ?? attempt.provider;
    const status = attempt.status ? `, HTTP ${attempt.status}` : "";
    return `${name} ${attempt.model}: ${attempt.kind}${status}`;
  });
  return `ошибка ИИ ${code}: ${REASONS[code]}${lines.length ? `\n${lines.join("\n")}` : ""}`;
}

/** Reports an AI failure to the admins (throttled per code). Never throws. */
export async function alertAiFailure(error: { code: AIAnalysisErrorCode; attempts: readonly AIAttempt[] }): Promise<void> {
  await raiseAlert(`ai_${error.code}`, aiErrorAdminText(error.code, error.attempts), { throttleMinutes: 30 });
}
