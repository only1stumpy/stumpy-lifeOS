import assert from "node:assert/strict";
import test from "node:test";
import { expandAiModelQueue, initializeAiModelQueue } from "../src/domain/ai-model-queue";

test("первичная очередь включает все новые модели по порядку доступности", () => {
  assert.deepEqual(
    initializeAiModelQueue([
      { providerId: "gemini", modelId: "flash" },
      { providerId: "groq", modelId: "fast" },
    ], []),
    [
      { providerId: "gemini", modelId: "flash", enabled: true, sortOrder: 0 },
      { providerId: "groq", modelId: "fast", enabled: true, sortOrder: 1 },
    ],
  );
});

test("миграция очереди сохраняет прежние выборы и добавляет новые модели включёнными", () => {
  assert.deepEqual(
    initializeAiModelQueue([
      { providerId: "gemini", modelId: "new" },
      { providerId: "gemini", modelId: "kept" },
      { providerId: "groq", modelId: "disabled" },
    ], [
      { providerId: "gemini", modelId: "kept", enabled: true, sortOrder: 3 },
      { providerId: "groq", modelId: "disabled", enabled: false, sortOrder: 0 },
      { providerId: "openrouter", modelId: "removed", enabled: true, sortOrder: 1 },
    ]),
    [
      { providerId: "gemini", modelId: "kept", enabled: true, sortOrder: 0 },
      { providerId: "gemini", modelId: "new", enabled: true, sortOrder: 1 },
      { providerId: "groq", modelId: "disabled", enabled: false, sortOrder: 2 },
    ],
  );
});

test("единую очередь моделей соблюдает приоритет между провайдерами и профилями", () => {
  const candidates = expandAiModelQueue(
    [
      { providerId: "groq", modelId: "fast" },
      { providerId: "gemini", modelId: "vision" },
      { providerId: "gemini", modelId: "flash" },
    ],
    [
      { id: "gemini-second", providerId: "gemini", sortOrder: 2, models: [{ id: "flash" }] },
      { id: "groq-profile", providerId: "groq", sortOrder: 0, models: [{ id: "fast" }] },
      { id: "gemini-first", providerId: "gemini", sortOrder: 1, models: [{ id: "vision" }, { id: "flash" }] },
    ],
  );

  assert.deepEqual(candidates.map(({ account, modelId }) => [account.id, modelId]), [
    ["groq-profile", "fast"],
    ["gemini-first", "vision"],
    ["gemini-first", "flash"],
    ["gemini-second", "flash"],
  ]);
});
