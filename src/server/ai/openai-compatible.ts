import type { AIAnalysisErrorCode } from "./types";
import { safeHttpsPost, SafeHttpsError, type AiProviderTransportFailureKind } from "./safe-fetch";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export type OpenAICompatibleConfig = {
  id?: string;
  name?: string;
  endpoint: string;
  model: string;
  apiKey: string;
  authHeaderName?: "authorization" | "x-goog-api-key";
};

export type OpenAICompatibleImage = {
  mimeType: string;
  dataBase64: string;
};

export type OpenAICompatibleCompletionInput = {
  systemPrompt: string;
  userText: string;
  image?: OpenAICompatibleImage;
  responseFormat?: "json_object" | "text";
  timeoutMs?: number;
};

export type AiProviderFailureKind = AiProviderTransportFailureKind;

/** Safe error facade. It never contains a provider response, endpoint or API key. */
export class AiProviderTransportError extends Error {
  readonly code: AIAnalysisErrorCode;

  constructor(readonly kind: AiProviderFailureKind) {
    super(messageForFailure(kind));
    this.name = "AiProviderTransportError";
    this.code = codeForFailure(kind);
  }
}

/** Call an OpenAI-compatible `/chat/completions` endpoint and return assistant text. */
export async function completeOpenAICompatible(
  config: OpenAICompatibleConfig,
  input: OpenAICompatibleCompletionInput,
): Promise<string> {
  if (
    !config.apiKey.trim() ||
    /[\u0000-\u001f\u007f]/.test(config.apiKey) ||
    !config.model.trim() ||
    !input.systemPrompt.trim() ||
    !input.userText.trim()
  ) {
    throw new AiProviderTransportError("configuration");
  }

  let userContent: string | Array<Record<string, unknown>> = input.userText;
  if (input.image) {
    validateImage(input.image);
    userContent = [
      { type: "text", text: input.userText },
      {
        type: "image_url",
        image_url: {
          url: `data:${input.image.mimeType};base64,${input.image.dataBase64}`,
        },
      },
    ];
  }

  const payload: Record<string, unknown> = {
    model: config.model,
    messages: [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: userContent },
    ],
  };
  if (input.responseFormat === "json_object") {
    payload.response_format = { type: "json_object" };
  }

  let response: { status: number; body: string };
  try {
    response = await safeHttpsPost(config.endpoint, config.apiKey, payload, {
      timeoutMs: input.timeoutMs,
      authHeaderName: config.authHeaderName,
    });
  } catch (error) {
    if (error instanceof SafeHttpsError) throw new AiProviderTransportError(error.kind);
    throw new AiProviderTransportError("unavailable");
  }

  if (response.status < 200 || response.status >= 300) {
    throw new AiProviderTransportError(classifyOpenAICompatibleFailure(response.status, response.body));
  }

  return extractOpenAICompatibleContent(response.body);
}

/** Classify structured provider codes/statuses without exposing raw error text. */
export function classifyOpenAICompatibleFailure(status: number, body: string): AiProviderFailureKind {
  const tokens = getStructuredErrorTokens(body);
  if (
    status === 402 ||
    tokens.some((token) => [
      "payment_required",
      "credit_balance_too_low",
      "billing_hard_limit_reached",
      "insufficient_credits",
      "credits_exhausted",
    ].includes(token))
  ) {
    return "credits_exhausted";
  }
  if (
    status === 429 ||
    tokens.some((token) => [
      "resource_exhausted",
      "quota_exceeded",
      "insufficient_quota",
      "rate_limit_exceeded",
      "rate_limit",
      "too_many_requests",
      "daily_limit_exceeded",
    ].includes(token))
  ) {
    return "quota_exceeded";
  }
  if (
    status === 401 ||
    status === 403 ||
    [400, 404, 422].includes(status) ||
    tokens.some((token) => [
      "invalid_api_key",
      "api_key_invalid",
      "authentication_error",
      "unauthorized",
      "unauthenticated",
      "permission_denied",
      "model_not_found",
      "not_found",
      "unsupported_model",
      "invalid_model",
      "invalid_argument",
      "failed_precondition",
    ].includes(token))
  ) {
    return "configuration";
  }
  if (status === 408 || status === 425 || status >= 500) return "unavailable";
  return "other";
}

/** Parse both common OpenAI string content and text-part arrays. */
export function extractOpenAICompatibleContent(body: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    throw new AiProviderTransportError("invalid_response");
  }
  const envelope = asRecord(parsed);
  const choices = Array.isArray(envelope?.choices) ? envelope.choices : [];
  const choice = asRecord(choices[0]);
  const message = asRecord(choice?.message);
  const content = message?.content;
  if (typeof content === "string" && content.trim().length > 0) return content;
  if (Array.isArray(content)) {
    const text = content
      .map((part) => asRecord(part)?.text)
      .filter((part): part is string => typeof part === "string")
      .join("");
    if (text.trim().length > 0) return text;
  }
  throw new AiProviderTransportError("invalid_response");
}

function validateImage(image: OpenAICompatibleImage): void {
  if (
    !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(image.mimeType) ||
    image.dataBase64.length === 0 ||
    image.dataBase64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.dataBase64) ||
    Buffer.from(image.dataBase64, "base64").byteLength > MAX_IMAGE_BYTES
  ) {
    throw new AiProviderTransportError("configuration");
  }
}

function getStructuredErrorTokens(body: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return [];
  }
  const envelope = asRecord(parsed);
  const error = asRecord(envelope?.error);
  if (!error) return [];

  const tokens: string[] = [];
  for (const key of ["status", "code", "type", "reason"] as const) {
    const value = error[key];
    if (typeof value === "string") tokens.push(normalizeToken(value));
    if (typeof value === "number") tokens.push(String(value));
  }
  if (Array.isArray(error.details)) {
    for (const detail of error.details.slice(0, 5)) {
      const record = asRecord(detail);
      for (const key of ["reason", "code", "status"] as const) {
        const value = record?.[key];
        if (typeof value === "string") tokens.push(normalizeToken(value));
      }
    }
  }
  return tokens;
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function codeForFailure(kind: AiProviderFailureKind): AIAnalysisErrorCode {
  switch (kind) {
    case "quota_exceeded": return "quota_exceeded";
    case "credits_exhausted": return "credits_exhausted";
    case "unavailable": return "provider_unavailable";
    case "configuration": return "provider_configuration";
    case "invalid_response": return "invalid_response";
    case "other": return "provider_failed";
  }
}

function messageForFailure(kind: AiProviderFailureKind): string {
  switch (kind) {
    case "quota_exceeded": return "Достигнут лимит запросов ИИ API.";
    case "credits_exhausted": return "Провайдер сообщает, что оплаченные кредиты исчерпаны.";
    case "unavailable": return "ИИ API сейчас не отвечает или временно недоступен.";
    case "configuration": return "Проверь endpoint, API-ключ, права доступа и название модели.";
    case "invalid_response": return "ИИ API ответило в неподдерживаемом формате.";
    case "other": return "Не получилось выполнить запрос к ИИ API.";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
