import { AppError } from "@/server/http";
import { classifyOpenAICompatibleFailure, completeOpenAICompatible } from "./openai-compatible";
import { safeHttpsGet, SafeHttpsError } from "./safe-fetch";

export const AI_PROVIDER_IDS = ["gemini", "groq", "cerebras", "openrouter", "custom"] as const;
export type AiProviderId = typeof AI_PROVIDER_IDS[number];

export type AiProviderCatalogModel = {
  id: string;
  name: string;
  supportsImages: boolean;
  contextLength: number | null;
  freeRequestsPerDay: number | null;
  freeRequestsPerMinute: number | null;
  freeTokensPerMinute: number | null;
};

export type AiProviderDefinition = {
  id: AiProviderId;
  name: string;
  endpoint: string;
  modelsEndpoint: (endpoint?: string) => string;
  modelsSearchParams?: Readonly<Record<string, string>>;
  modelsAuthHeaderName?: "authorization" | "x-goog-api-key";
  authHeaderName: "authorization" | "x-goog-api-key";
  supportsImages: boolean;
  connectable: boolean;
  connectionBlockReason: string | null;
  description: string;
};

const freeTierModelIds: Record<Exclude<AiProviderId, "custom">, ReadonlySet<string>> = {
  gemini: new Set(["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.8-flash"]),
  groq: new Set(["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"]),
  cerebras: new Set(["gpt-oss-120b", "qwen-3.8-27b"]),
  openrouter: new Set(),
};

const definitions: AiProviderDefinition[] = [
  {
    id: "gemini",
    name: "Gemini",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/openai",
    modelsEndpoint: () => "https://generativelanguage.googleapis.com/v1beta/models",
    modelsAuthHeaderName: "x-goog-api-key",
    authHeaderName: "authorization",
    supportsImages: true,
    connectable: true,
    connectionBlockReason: null,
    description: "Текст и фото · понадобится подтверждение Free Tier",
  },
  {
    id: "groq",
    name: "Groq",
    endpoint: "https://api.groq.com/openai/v1",
    modelsEndpoint: () => "https://api.groq.com/openai/v1/models",
    authHeaderName: "authorization",
    supportsImages: false,
    connectable: true,
    connectionBlockReason: null,
    description: "Бесплатные модели для текста",
  },
  {
    id: "cerebras",
    name: "Cerebras",
    endpoint: "https://api.cerebras.ai/v1",
    modelsEndpoint: () => "https://api.cerebras.ai/v1/models",
    authHeaderName: "authorization",
    supportsImages: false,
    connectable: false,
    connectionBlockReason: "Cerebras требует привязать платёжный метод для пробных кредитов; постоянного бесплатного тарифа нет.",
    description: "Не подходит под режим без карты: пробный доступ требует платёжный метод и действует 30 дней.",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    endpoint: "https://openrouter.ai/api/v1",
    modelsEndpoint: () => "https://openrouter.ai/api/v1/models",
    modelsSearchParams: { max_price: "0" },
    authHeaderName: "authorization",
    supportsImages: true,
    connectable: true,
    connectionBlockReason: null,
    description: "В каталоге только бесплатные модели с суффиксом :free",
  },
  {
    id: "custom",
    name: "OpenAI-compatible",
    endpoint: "",
    modelsEndpoint: (endpoint = "") => `${endpoint.replace(/\/+$/, "")}/models`,
    authHeaderName: "authorization",
    supportsImages: false,
    connectable: true,
    connectionBlockReason: null,
    description: "Расширенный режим · стоимость endpoint не проверяется",
  },
];

/** Providers kept only so old rows and API values stay valid; they are not offered for connection. */
const RETIRED_PROVIDER_IDS: ReadonlySet<AiProviderId> = new Set<AiProviderId>(["cerebras"]);

export function listAiProviderDefinitions(): AiProviderDefinition[] {
  return definitions.filter((definition) => !RETIRED_PROVIDER_IDS.has(definition.id));
}

export function getAiProviderDefinition(providerId: AiProviderId): AiProviderDefinition {
  const definition = definitions.find((provider) => provider.id === providerId);
  if (!definition) throw new AppError(400, "Неизвестный ИИ-провайдер.");
  return definition;
}

/** Fetch the live model list, then intersect it with the provider's documented free models. */
export async function discoverFreeModels(
  providerId: AiProviderId,
  apiKey: string,
  endpoint?: string,
): Promise<AiProviderCatalogModel[]> {
  const provider = getAiProviderDefinition(providerId);
  assertAiProviderCanConnect(provider);
  const url = provider.modelsEndpoint(endpoint);
  let response;
  try {
    response = await safeHttpsGet(url, apiKey, {
      timeoutMs: 12_000,
      maxResponseBytes: 512 * 1024,
      authHeaderName: provider.modelsAuthHeaderName ?? provider.authHeaderName,
      ...(provider.modelsSearchParams ? { searchParams: provider.modelsSearchParams } : {}),
    });
  } catch (error) {
    if (error instanceof SafeHttpsError) {
      throw new AppError(error.kind === "configuration" ? 400 : 502, messageForTransportError(error.kind));
    }
    throw new AppError(502, "Не удалось связаться с каталогом моделей провайдера.");
  }

  if (response.status < 200 || response.status >= 300) {
    const failure = classifyOpenAICompatibleFailure(response.status, response.body);
    throw new AppError(statusForTransportFailure(failure), messageForTransportError(failure));
  }

  const payload = parsePayload(response.body);
  const rows = providerId === "gemini" ? arrayAt(payload, "models") : arrayAt(payload, "data");
  const models = rows.flatMap((row) => normalizeProviderModel(providerId, row));
  if (models.length === 0) {
    throw new AppError(400, providerId === "custom"
      ? "Каталог не вернул модели. Проверьте совместимость endpoint и путь /models."
      : "У этого ключа пока нет доступных бесплатных моделей из каталога.");
  }
  return models.sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

/** A single short completion validates model access before any credential is stored. */
export async function testProviderModel(
  providerId: AiProviderId,
  model: AiProviderCatalogModel,
  apiKey: string,
  endpoint?: string,
): Promise<void> {
  const provider = getAiProviderDefinition(providerId);
  assertAiProviderCanConnect(provider);
  try {
    await completeOpenAICompatible({
      endpoint: endpoint ?? provider.endpoint,
      model: model.id,
      apiKey,
      authHeaderName: provider.authHeaderName,
    }, {
      systemPrompt: "Answer with exactly: OK",
      userText: "Reply with OK.",
      responseFormat: "text",
      timeoutMs: 12_000,
    });
  } catch (error) {
    const kind = typeof error === "object" && error !== null && "kind" in error && typeof error.kind === "string"
      ? error.kind
      : "other";
    const failure = kind as Parameters<typeof messageForTransportError>[0];
    throw new AppError(statusForTransportFailure(failure), `Проверка ключа не прошла: ${messageForTransportError(failure)}.`);
  }
}

export function assertAiProviderCanConnect(provider: AiProviderDefinition): void {
  if (!provider.connectable) {
    throw new AppError(400, provider.connectionBlockReason ?? "Этот провайдер недоступен для подключения.");
  }
}

export function normalizeProviderModel(providerId: AiProviderId, value: unknown): AiProviderCatalogModel[] {
  if (typeof value !== "object" || value === null) return [];
  const model = value as Record<string, unknown>;
  const rawId = typeof model.id === "string" ? model.id : typeof model.name === "string" ? model.name : "";
  const id = rawId.replace(/^models\//, "");
  if (!id || id.length > 200) return [];

  if (providerId === "openrouter") {
    const pricing = recordAt(model, "pricing");
    const architecture = recordAt(model, "architecture");
    const inputModalities = Array.isArray(architecture?.input_modalities) ? architecture.input_modalities : [];
    const free = id.endsWith(":free") && isZero(pricing?.prompt) && isZero(pricing?.completion);
    if (!free) return [];
    return [makeModel(id, textAt(model, "name") ?? id, inputModalities.includes("image"), integerAt(model, "context_length"), {
      freeRequestsPerDay: 50,
      freeRequestsPerMinute: 20,
      freeTokensPerMinute: null,
    })];
  }

  if (providerId === "custom") {
    const architecture = recordAt(model, "architecture");
    const inputModalities = Array.isArray(architecture?.input_modalities) ? architecture.input_modalities : [];
    return [makeModel(id, textAt(model, "name") ?? id, inputModalities.includes("image"), integerAt(model, "context_length"), null)];
  }

  if (!freeTierModelIds[providerId].has(id)) return [];
  if (providerId === "gemini") {
    const methods = Array.isArray(model.supportedGenerationMethods) ? model.supportedGenerationMethods : [];
    if (!methods.includes("generateContent")) return [];
    const supportsImages = id === "gemini-3.5-flash-lite" || id === "gemini-3.1-flash-lite" || id === "gemini-3.8-flash";
    return [makeModel(id, textAt(model, "displayName") ?? id, supportsImages, integerAt(model, "inputTokenLimit"), null)];
  }

  const contextLength = integerAt(model, "context_window") ?? integerAt(model, "context_length");
  // Groq's published figures are Developer-tier baselines, not guaranteed Free-tier quotas.
  return [makeModel(id, textAt(model, "name") ?? id, false, contextLength, null)];
}

function makeModel(
  id: string,
  name: string,
  supportsImages: boolean,
  contextLength: number | null,
  limits: Pick<AiProviderCatalogModel, "freeRequestsPerDay" | "freeRequestsPerMinute" | "freeTokensPerMinute"> | null,
): AiProviderCatalogModel {
  return {
    id,
    name: name.slice(0, 200),
    supportsImages,
    contextLength,
    freeRequestsPerDay: limits?.freeRequestsPerDay ?? null,
    freeRequestsPerMinute: limits?.freeRequestsPerMinute ?? null,
    freeTokensPerMinute: limits?.freeTokensPerMinute ?? null,
  };
}

function parsePayload(body: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch { /* response content is deliberately not exposed */ }
  throw new AppError(502, "Каталог провайдера вернул данные в непонятном формате.");
}

function arrayAt(record: Record<string, unknown>, key: string): unknown[] {
  return Array.isArray(record[key]) ? record[key] as unknown[] : [];
}

function recordAt(record: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = record[key];
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function textAt(record: Record<string, unknown>, key: string): string | null {
  return typeof record[key] === "string" ? record[key] as string : null;
}

function integerAt(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function isZero(value: unknown): boolean {
  if (typeof value === "number") return value === 0;
  return typeof value === "string" && Number(value) === 0;
}

function messageForTransportError(kind: string): string {
  if (kind === "quota_exceeded") return "провайдер ограничил запрос по бесплатной квоте";
  if (kind === "credits_exhausted") return "провайдер сообщает об исчерпанном балансе";
  if (kind === "configuration") return "провайдер отклонил ключ. Проверьте, что он скопирован целиком и без пробелов";
  if (kind === "unavailable") return "API провайдера сейчас недоступен, это не ошибка ключа. Повторите через минуту";
  if (kind === "invalid_response") return "провайдер вернул непонятный ответ";
  return "API провайдера не ответил на проверку";
}

function statusForTransportFailure(kind: string): number {
  if (kind === "configuration") return 400;
  if (kind === "credits_exhausted") return 402;
  if (kind === "quota_exceeded") return 429;
  return 502;
}
