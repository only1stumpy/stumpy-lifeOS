import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../src/server/http";
import {
  assertAiProviderCanConnect,
  getAiProviderDefinition,
  normalizeProviderModel,
} from "../src/server/ai/provider-catalog";

test("Cerebras remains visible but is blocked before model discovery and completion", () => {
  const cerebras = getAiProviderDefinition("cerebras");
  assert.equal(cerebras.connectable, false);
  assert.match(cerebras.connectionBlockReason ?? "", /платёжный метод/i);
  assert.match(cerebras.connectionBlockReason ?? "", /постоянного бесплатного тарифа нет/i);
  assert.throws(() => assertAiProviderCanConnect(cerebras), (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.status, 400);
    assert.match(error.message, /платёжный метод/i);
    return true;
  });
});

test("OpenRouter discovery only admits zero-priced :free models", () => {
  const free = normalizeProviderModel("openrouter", {
    id: "vendor/free-model:free",
    name: "Free model",
    pricing: { prompt: "0", completion: "0" },
    architecture: { input_modalities: ["text", "image"] },
    context_length: 32_000,
  });
  assert.equal(free.length, 1);
  assert.equal(free[0]?.supportsImages, true);
  assert.equal(free[0]?.freeRequestsPerDay, 50);
  assert.equal(free[0]?.freeRequestsPerMinute, 20);

  assert.deepEqual(normalizeProviderModel("openrouter", {
    id: "vendor/paid-model",
    pricing: { prompt: "0", completion: "0" },
  }), []);
  assert.deepEqual(normalizeProviderModel("openrouter", {
    id: "vendor/free-model:free",
    pricing: { prompt: "0.000001", completion: "0" },
  }), []);
});

test("Groq catalog does not present Developer-tier limits as free-tier quotas", () => {
  const [model] = normalizeProviderModel("groq", { id: "openai/gpt-oss-120b", name: "GPT OSS 120B", context_window: 131_072 });
  assert.ok(model);
  assert.equal(model.freeRequestsPerDay, null);
  assert.equal(model.freeRequestsPerMinute, null);
  assert.equal(model.freeTokensPerMinute, null);
});

test("Gemini models are admitted only when the API marks generateContent available", () => {
  const valid = normalizeProviderModel("gemini", {
    name: "models/gemini-3.5-flash-lite",
    displayName: "Gemini Flash Lite",
    supportedGenerationMethods: ["generateContent"],
    inputTokenLimit: 128_000,
  });
  assert.equal(valid.length, 1);
  assert.equal(valid[0]?.supportsImages, true);
  assert.deepEqual(normalizeProviderModel("gemini", {
    name: "models/gemini-3.5-flash-lite",
    supportedGenerationMethods: ["embedContent"],
  }), []);
});

test("Gemini separates catalog key auth from OpenAI-compatible completion auth", () => {
  const gemini = getAiProviderDefinition("gemini");
  assert.equal(gemini.modelsAuthHeaderName, "x-goog-api-key");
  assert.equal(gemini.authHeaderName, "authorization");
});

test("OpenRouter model discovery only requests zero-priced catalog entries", () => {
  const openrouter = getAiProviderDefinition("openrouter");
  assert.deepEqual(openrouter.modelsSearchParams, { max_price: "0" });
});
