import { safeHttpsGet } from "./safe-fetch";

/**
 * Real rate-limit data reported by providers. Nothing here is estimated: a field is `null`
 * when the provider did not send it. Sources are the headers of requests LifeOS already makes
 * (no extra paid calls) and the free OpenRouter `GET /key` endpoint.
 */
export type RateLimitWindow = {
  limit: number | null;
  remaining: number | null;
  /** Seconds until the provider resets this window, as reported at observation time. */
  resetSeconds: number | null;
};

export type ObservedRateLimits = {
  requests: RateLimitWindow | null;
  tokens: RateLimitWindow | null;
  /** Seconds from a `retry-after` header (sent with 429). */
  retryAfterSeconds: number | null;
};

export type ObservedLimitsEntry = ObservedRateLimits & { observedAt: string };

export type KeyCreditInfo = {
  /** Spend cap on the key in credits; null means no cap is set. */
  creditLimit: number | null;
  creditRemaining: number | null;
  usage: number | null;
  isFreeTier: boolean | null;
  observedAt: string;
};

const OBSERVATION_TTL_MS = 6 * 60 * 60_000;
const KEY_INFO_TTL_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 500;

const observed = new Map<string, ObservedLimitsEntry & { at: number }>();
const keyInfo = new Map<string, { at: number; value: KeyCreditInfo | null }>();

/**
 * Parse `x-ratelimit-*` / `retry-after` headers. Covers the OpenAI-style names used by Groq,
 * OpenRouter and most OpenAI-compatible gateways. Returns null if nothing usable is present.
 * Header names must be lowercase (as produced by safe-fetch).
 */
export function parseRateLimitHeaders(headers: Readonly<Record<string, string>>): ObservedRateLimits | null {
  const requests = readWindow(headers, "requests");
  const tokens = readWindow(headers, "tokens");
  const retryAfterSeconds = parseDurationSeconds(headers["retry-after"]);
  if (!requests && !tokens && retryAfterSeconds === null) return null;
  return { requests, tokens, retryAfterSeconds };
}

function readWindow(headers: Readonly<Record<string, string>>, kind: "requests" | "tokens"): RateLimitWindow | null {
  const limit = parseCount(headers[`x-ratelimit-limit-${kind}`]);
  const remaining = parseCount(headers[`x-ratelimit-remaining-${kind}`]);
  const resetSeconds = parseDurationSeconds(headers[`x-ratelimit-reset-${kind}`]);
  if (limit === null && remaining === null && resetSeconds === null) return null;
  return { limit, remaining, resetSeconds };
}

function parseCount(value: string | undefined): number | null {
  if (value === undefined || !/^\d{1,15}$/.test(value.trim())) return null;
  return Number(value.trim());
}

/** Accepts plain seconds ("30", "1.5") and Go-style durations ("2m59.56s", "7.66s", "250ms", "1h2m"). */
export function parseDurationSeconds(value: string | undefined): number | null {
  if (value === undefined) return null;
  const text = value.trim().toLowerCase();
  if (!text || text.length > 40) return null;
  if (/^\d+(\.\d+)?$/.test(text)) return roundSeconds(Number(text));
  if (!/^(\d+(\.\d+)?(ms|h|m|s))+$/.test(text)) return null;
  let total = 0;
  for (const [, amount, unit] of text.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    const number = Number(amount);
    total += unit === "h" ? number * 3600 : unit === "m" ? number * 60 : unit === "ms" ? number / 1000 : number;
  }
  return roundSeconds(total);
}

function roundSeconds(value: number): number | null {
  return Number.isFinite(value) && value >= 0 && value < 10 * 365 * 86_400 ? Math.round(value * 10) / 10 : null;
}

/** Parse the body of OpenRouter `GET /api/v1/key`. Unknown shapes yield null. */
export function parseOpenRouterKeyInfo(body: string, now: Date = new Date()): KeyCreditInfo | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const data = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>).data : null;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  const creditLimit = money(record.limit);
  const creditRemaining = money(record.limit_remaining);
  const usage = money(record.usage);
  const isFreeTier = typeof record.is_free_tier === "boolean" ? record.is_free_tier : null;
  if (creditLimit === null && creditRemaining === null && usage === null && isFreeTier === null) return null;
  return { creditLimit, creditRemaining, usage, isFreeTier, observedAt: now.toISOString() };
}

function money(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) < 1e12 ? value : null;
}

function observationKey(accountId: string, modelId: string): string {
  return `${accountId}\u0000${modelId}`;
}

/** Remember the latest limits seen for an account/model. Per-instance memory; not a durable store. */
export function recordObservedLimits(accountId: string, modelId: string, limits: ObservedRateLimits | null, now: Date = new Date()): void {
  if (!limits) return;
  if (observed.size >= MAX_CACHE_ENTRIES) evictOldest(observed);
  observed.set(observationKey(accountId, modelId), { ...limits, observedAt: now.toISOString(), at: now.getTime() });
}

export function getObservedLimits(accountId: string, modelId: string, now: Date = new Date()): ObservedLimitsEntry | null {
  const entry = observed.get(observationKey(accountId, modelId));
  if (!entry) return null;
  if (now.getTime() - entry.at > OBSERVATION_TTL_MS) {
    observed.delete(observationKey(accountId, modelId));
    return null;
  }
  const { at: _at, ...rest } = entry;
  void _at;
  return rest;
}

function evictOldest(map: Map<string, { at: number }>): void {
  const oldest = [...map.entries()].sort((a, b) => a[1].at - b[1].at)[0];
  if (oldest) map.delete(oldest[0]);
}

export type FetchKeyInfoOptions = { fetch?: typeof safeHttpsGet; now?: Date };

/**
 * OpenRouter key limits via the free `/key` endpoint, cached 5 minutes per account so opening
 * the panel does not hit the provider every time. Failures are cached as "unknown" as well.
 */
export async function getOpenRouterKeyInfo(
  accountId: string,
  apiKey: string,
  options: FetchKeyInfoOptions = {},
): Promise<KeyCreditInfo | null> {
  const now = options.now ?? new Date();
  const cached = keyInfo.get(accountId);
  if (cached && now.getTime() - cached.at < KEY_INFO_TTL_MS) return cached.value;

  let value: KeyCreditInfo | null = null;
  try {
    const response = await (options.fetch ?? safeHttpsGet)("https://openrouter.ai/api/v1/key", apiKey, {
      timeoutMs: 4_000,
      maxResponseBytes: 32 * 1024,
    });
    if (response.status >= 200 && response.status < 300) value = parseOpenRouterKeyInfo(response.body, now);
  } catch {
    value = null;
  }
  if (keyInfo.size >= MAX_CACHE_ENTRIES) evictOldest(keyInfo);
  keyInfo.set(accountId, { at: now.getTime(), value });
  return value;
}

/** Test hook. */
export function resetProviderLimitCaches(): void {
  observed.clear();
  keyInfo.clear();
}
