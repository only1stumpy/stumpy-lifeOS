import assert from "node:assert/strict";
import test from "node:test";

import { clipboardKeyHints, readClipboardKey } from "../src/components/ai-providers/clipboard-key";
import {
  getObservedLimits,
  getOpenRouterKeyInfo,
  parseDurationSeconds,
  parseOpenRouterKeyInfo,
  parseRateLimitHeaders,
  recordObservedLimits,
  resetProviderLimitCaches,
} from "../src/server/ai/provider-limits";

// Fixtures mirror the documented header shapes; no real keys or live calls.
const groqHeaders = {
  "x-ratelimit-limit-requests": "14400",
  "x-ratelimit-limit-tokens": "18000",
  "x-ratelimit-remaining-requests": "14370",
  "x-ratelimit-remaining-tokens": "17997",
  "x-ratelimit-reset-requests": "2m59.56s",
  "x-ratelimit-reset-tokens": "7.66s",
};

test("Groq: заголовки x-ratelimit-* дают лимит, остаток и сброс по запросам и токенам", () => {
  const limits = parseRateLimitHeaders(groqHeaders);
  assert.deepEqual(limits, {
    requests: { limit: 14400, remaining: 14370, resetSeconds: 179.6 },
    tokens: { limit: 18000, remaining: 17997, resetSeconds: 7.7 },
    retryAfterSeconds: null,
  });
});

test("429 с retry-after без остальных заголовков сохраняет только паузу", () => {
  assert.deepEqual(parseRateLimitHeaders({ "retry-after": "30" }), { requests: null, tokens: null, retryAfterSeconds: 30 });
});

test("Gemini и прочие без rate-limit заголовков: null, то есть «лимит неизвестен», а не выдуманные цифры", () => {
  assert.equal(parseRateLimitHeaders({ "content-type": "application/json", "x-goog-request-id": "abc" }), null);
  assert.equal(parseRateLimitHeaders({}), null);
});

test("мусорные значения заголовков отбрасываются", () => {
  const limits = parseRateLimitHeaders({ "x-ratelimit-limit-requests": "lots", "x-ratelimit-remaining-requests": "-5", "x-ratelimit-reset-requests": "soon" });
  assert.equal(limits, null);
  assert.equal(parseDurationSeconds("1h2m"), 3720);
  assert.equal(parseDurationSeconds("250ms"), 0.3);
  assert.equal(parseDurationSeconds("12"), 12);
  assert.equal(parseDurationSeconds("-3"), null);
});

test("OpenAI-совместимый endpoint: частичные заголовки читаются как есть", () => {
  const limits = parseRateLimitHeaders({ "x-ratelimit-remaining-requests": "5" });
  assert.deepEqual(limits, { requests: { limit: null, remaining: 5, resetSeconds: null }, tokens: null, retryAfterSeconds: null });
});

test("OpenRouter /key: лимит, остаток, расход и бесплатный тариф", () => {
  const now = new Date("2026-11-21T10:00:00Z");
  const info = parseOpenRouterKeyInfo(JSON.stringify({ data: { label: "sk-or-v1-xxx", limit: 10, limit_remaining: 7.5, usage: 2.5, is_free_tier: false } }), now);
  assert.deepEqual(info, { creditLimit: 10, creditRemaining: 7.5, usage: 2.5, isFreeTier: false, observedAt: now.toISOString() });
  const free = parseOpenRouterKeyInfo(JSON.stringify({ data: { limit: null, limit_remaining: null, usage: 0, is_free_tier: true } }), now);
  assert.equal(free?.creditLimit, null);
  assert.equal(free?.isFreeTier, true);
  assert.equal(JSON.stringify(info).includes("sk-or"), false, "метка ключа не попадает в результат");
});

test("OpenRouter /key: чужая форма ответа даёт null", () => {
  assert.equal(parseOpenRouterKeyInfo("not json"), null);
  assert.equal(parseOpenRouterKeyInfo(JSON.stringify({ data: {} })), null);
  assert.equal(parseOpenRouterKeyInfo(JSON.stringify([])), null);
});

test("getOpenRouterKeyInfo кэширует ответ на 5 минут, в том числе неудачу", async () => {
  resetProviderLimitCaches();
  let calls = 0;
  const ok = async () => { calls += 1; return { status: 200, headers: {}, body: JSON.stringify({ data: { limit: 5, limit_remaining: 4, usage: 1 } }) }; };
  const t0 = new Date("2026-11-21T10:00:00Z");
  assert.equal((await getOpenRouterKeyInfo("a1", "k", { fetch: ok, now: t0 }))?.creditRemaining, 4);
  await getOpenRouterKeyInfo("a1", "k", { fetch: ok, now: new Date(t0.getTime() + 60_000) });
  assert.equal(calls, 1);
  await getOpenRouterKeyInfo("a1", "k", { fetch: ok, now: new Date(t0.getTime() + 6 * 60_000) });
  assert.equal(calls, 2);

  const failing = async () => { calls += 1; throw new Error("boom"); };
  assert.equal(await getOpenRouterKeyInfo("a2", "k", { fetch: failing, now: t0 }), null);
  await getOpenRouterKeyInfo("a2", "k", { fetch: failing, now: new Date(t0.getTime() + 1_000) });
  assert.equal(calls, 3, "неудача тоже кэшируется, провайдера не долбим");
  const denied = async () => ({ status: 401, headers: {}, body: "{}" });
  assert.equal(await getOpenRouterKeyInfo("a3", "k", { fetch: denied, now: t0 }), null);
});

test("наблюдаемые лимиты хранятся по аккаунту и модели и устаревают через 6 часов", () => {
  resetProviderLimitCaches();
  const t0 = new Date("2026-11-21T10:00:00Z");
  recordObservedLimits("acc", "model-a", parseRateLimitHeaders(groqHeaders), t0);
  recordObservedLimits("acc", "model-b", parseRateLimitHeaders({}), t0);
  assert.equal(getObservedLimits("acc", "model-a", t0)?.requests?.remaining, 14370);
  assert.equal(getObservedLimits("acc", "model-b", t0), null);
  assert.equal(getObservedLimits("other", "model-a", t0), null);
  assert.equal(getObservedLimits("acc", "model-a", new Date(t0.getTime() + 7 * 3_600_000)), null);
});

test("буфер обмена: разрешено / пусто / не ключ / отказ / API недоступен", async () => {
  assert.deepEqual(await readClipboardKey({ readText: async () => "  AIza-test-key \n" }), { status: "ok", text: "AIza-test-key" });
  assert.deepEqual(await readClipboardKey({ readText: async () => "   " }), { status: "empty" });
  assert.deepEqual(await readClipboardKey({ readText: async () => "два слова" }), { status: "invalid" });
  assert.deepEqual(await readClipboardKey({ readText: async () => "x".repeat(9000) }), { status: "invalid" });
  assert.deepEqual(await readClipboardKey({ readText: async () => { throw new DOMException("denied", "NotAllowedError"); } }), { status: "denied" });
  assert.deepEqual(await readClipboardKey(undefined), { status: "unavailable" });
  assert.equal(clipboardKeyHints.denied, "Вставь ключ долгим нажатием в поле.");
  assert.equal(clipboardKeyHints.unavailable, clipboardKeyHints.denied);
});
