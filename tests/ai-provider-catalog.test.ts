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

test("Gemini and Groq models are matched by family pattern, not by a fixed id list", () => {
  const gemini = (id: string) => normalizeProviderModel("gemini", { name: `models/${id}`, supportedGenerationMethods: ["generateContent"] }).length;
  assert.equal(gemini("gemini-4-flash-lite"), 1);
  assert.equal(gemini("gemini-3.9-flash"), 1);
  assert.equal(gemini("gemini-3.5-pro"), 0);
  assert.equal(gemini("gemini-3.5-flash-preview-tts"), 0);
  const groq = (id: string) => normalizeProviderModel("groq", { id }).length;
  assert.equal(groq("openai/gpt-oss-120b"), 1);
  assert.equal(groq("qwen/qwen4-32b"), 1);
  assert.equal(groq("whisper-large-v3"), 0);
});

test("Cloudflare endpoint is built from a validated 32-hex Account ID", async () => {
  const { cloudflareEndpoint, normalizeCloudflareAccountId } = await import("../src/server/ai/provider-catalog");
  const id = "023E105F4ECEF8AD9CA31A8372D0C353";
  assert.equal(
    cloudflareEndpoint(` ${id} `),
    "https://api.cloudflare.com/client/v4/accounts/023e105f4ecef8ad9ca31a8372d0c353/ai/v1",
  );
  for (const bad of ["", "abc", `${id}0`, id.replace("0", "g"), "../../evil/023e105f4ecef8ad9ca31a8372d0c3", `${id}/x`]) {
    assert.throws(() => normalizeCloudflareAccountId(bad), (error: unknown) => error instanceof AppError && error.status === 400, bad);
  }
});

test("Cloudflare catalog is a fixed free list without paid-only models and with cautious image flags", async () => {
  const { discoverFreeModels } = await import("../src/server/ai/provider-catalog");
  const models = await discoverFreeModels("cloudflare", "unused-key");
  const ids = models.map((model) => model.id);
  assert.ok(ids.length >= 5 && ids.every((id) => id.startsWith("@cf/")));
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(!ids.some((id) => /kimi|glm-5|deepseek-v4|inkling/.test(id)));
  assert.deepEqual(models.filter((model) => model.supportsImages).map((model) => model.id).sort(), [
    "@cf/meta/llama-3.2-11b-vision-instruct",
    "@cf/meta/llama-4-scout-17b-16e-instruct",
    "@cf/mistralai/mistral-small-3.1-24b-instruct",
  ]);
  // Neuron quota is not a request count: limits stay unknown instead of invented.
  assert.ok(models.every((model) => model.freeRequestsPerDay === null && model.freeRequestsPerMinute === null));
  assert.deepEqual(normalizeProviderModel("cloudflare", { id: "@cf/moonshotai/kimi-k2.6" }), []);
});

test("Cloudflare 401/403/429 map to clear causes", async () => {
  const { classifyOpenAICompatibleFailure } = await import("../src/server/ai/openai-compatible");
  const { cloudflareFailureMessage } = await import("../src/server/ai/provider-catalog");
  assert.equal(classifyOpenAICompatibleFailure(401, "{}"), "configuration");
  assert.equal(classifyOpenAICompatibleFailure(403, JSON.stringify({ success: false, errors: [{ code: 10000 }] })), "configuration");
  assert.equal(classifyOpenAICompatibleFailure(429, "{}"), "quota_exceeded");
  assert.match(cloudflareFailureMessage("configuration"), /Account ID.*Workers AI.*Workers Paid/s);
  assert.match(cloudflareFailureMessage("quota_exceeded"), /10 000 Neurons.*00:00 UTC/s);
});
