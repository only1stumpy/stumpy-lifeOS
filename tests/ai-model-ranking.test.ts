import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { defaultPreselection, isUnsuitableModel, parseModelId, rankAiModels, type RankableModel } from "../src/domain/ai-model-ranking";
import { connectAiProviderAccount, listAiProviderCards, refreshAiProviderAccountModels, setAiProviderModelQueue } from "../src/server/ai/provider-accounts";
import { createCommandDb, newTelegramId, ownerOf, releaseCommandDb, type CommandDb } from "./helpers/command-db";
import { chatReply, startFakeProvider } from "./helpers/fake-provider";

const m = (id: string, supportsImages = false, contextLength: number | null = null): RankableModel => ({ id, supportsImages, contextLength });
const ids = (models: RankableModel[]) => models.map((model) => model.id);
/** Same set in a few different input orders must give one and the same output. */
function assertStable(providerId: Parameters<typeof rankAiModels>[0], models: RankableModel[]) {
  const expected = ids(rankAiModels(providerId, models));
  assert.deepEqual(ids(rankAiModels(providerId, models.slice().reverse())), expected);
  assert.deepEqual(ids(rankAiModels(providerId, models.slice().sort((a, b) => a.id.localeCompare(b.id)))), expected);
  return expected;
}

describe("разбор id модели", () => {
  test("версия и размер читаются только из id", () => {
    assert.deepEqual(parseModelId("llama-3.3-70b-versatile"), { version: [3, 3], sizeB: 70 });
    assert.deepEqual(parseModelId("meta-llama/llama-4-scout-17b-16e-instruct"), { version: [4], sizeB: 17 });
    assert.deepEqual(parseModelId("openai/gpt-oss-120b"), { version: [], sizeB: 120 });
    assert.deepEqual(parseModelId("qwen/qwen3-32b"), { version: [3], sizeB: 32 });
    assert.deepEqual(parseModelId("google/gemma-3n-e2b-it:free"), { version: [3], sizeB: 2 });
    assert.deepEqual(parseModelId("gemini-2.5-flash-lite"), { version: [2, 5], sizeB: null });
  });
  test("мусорные модели узнаются по токенам, а не по подстроке", () => {
    for (const id of ["whisper-large-v3", "playai-tts", "meta-llama/llama-prompt-guard-2-86m", "text-embedding-004", "gemini-2.5-flash-image", "gemini-live-2.5-flash"]) {
      assert.equal(isUnsuitableModel(id), true, id);
    }
    for (const id of ["gemini-2.5-flash", "llama-3.3-70b-versatile", "deliverable-70b", "openai/gpt-oss-20b:free"]) {
      assert.equal(isUnsuitableModel(id), false, id);
    }
  });
});

describe("ранжирование моделей по провайдерам", () => {
  test("Gemini: flash выше flash-lite, новее выше, vision-флаг важнее всего", () => {
    const order = assertStable("gemini", [
      m("gemini-2.0-flash-lite", true), m("gemini-2.5-flash", true), m("gemini-3.5-flash-lite", true), m("gemini-2.0-flash", true),
      m("gemini-3.5-flash", true), m("gemini-2.5-flash-lite", true), m("gemini-3-flash", true),
    ]);
    assert.deepEqual(order, ["gemini-3.5-flash", "gemini-3-flash", "gemini-2.5-flash", "gemini-2.0-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash-lite", "gemini-2.0-flash-lite"]);
  });

  test("Groq: сильные семейства и крупнее выше, мелкие 8b ниже, мусор в самом конце", () => {
    const order = assertStable("groq", [
      m("llama-3.1-8b-instant"), m("openai/gpt-oss-20b"), m("whisper-large-v3"), m("llama-3.3-70b-versatile"), m("openai/gpt-oss-120b"),
      m("qwen/qwen3-32b"), m("meta-llama/llama-4-scout-17b-16e-instruct"), m("meta-llama/llama-prompt-guard-2-86m"), m("playai-tts"),
    ]);
    assert.deepEqual(order.slice(0, 6), ["meta-llama/llama-4-scout-17b-16e-instruct", "llama-3.3-70b-versatile", "qwen/qwen3-32b", "openai/gpt-oss-120b", "openai/gpt-oss-20b", "llama-3.1-8b-instant"]);
    assert.deepEqual(order.slice(6).sort(), ["meta-llama/llama-prompt-guard-2-86m", "playai-tts", "whisper-large-v3"]);
  });

  test("OpenRouter :free: сначала vision, внутри — больший контекст, затем версия и размер, крошечные ниже", () => {
    const order = assertStable("openrouter", [
      m("meta-llama/llama-3.3-70b-instruct:free", false, 131_072),
      m("google/gemma-3-27b-it:free", true, 131_072),
      m("mistralai/mistral-small-3.2-24b-instruct:free", true, 128_000),
      m("google/gemma-3n-e2b-it:free", true, 8_192),
      m("openai/gpt-oss-20b:free", false, 131_072),
      m("deepseek/deepseek-r1:free", false, 163_840),
      m("nvidia/nemotron-nano-9b-v2:free", false, 128_000),
      m("qwen/qwen3-embedding-8b:free", false, 32_768),
    ]);
    assert.deepEqual(order, [
      "google/gemma-3-27b-it:free", "mistralai/mistral-small-3.2-24b-instruct:free", "google/gemma-3n-e2b-it:free",
      "deepseek/deepseek-r1:free", "meta-llama/llama-3.3-70b-instruct:free", "openai/gpt-oss-20b:free", "nvidia/nemotron-nano-9b-v2:free",
      "qwen/qwen3-embedding-8b:free",
    ]);
  });

  test("custom endpoint: только vision-флаг, дальше стабильный порядок по id без догадок о провайдере", () => {
    const order = assertStable("custom", [m("zeta-70b"), m("alpha-1b"), m("vision-x", true), m("mid-3.3")]);
    assert.deepEqual(order, ["vision-x", "alpha-1b", "mid-3.3", "zeta-70b"]);
  });

  test("ранжирование не меняет входной массив", () => {
    const input = [m("b"), m("a")];
    rankAiModels("custom", input);
    assert.deepEqual(ids(input), ["b", "a"]);
  });
});

describe("предвыбор для нового аккаунта", () => {
  test("до трёх лучших vision-моделей и одна лучшая текстовая", () => {
    const ranked = rankAiModels("openrouter", [
      m("a/v1-70b:free", true, 200_000), m("b/v2-30b:free", true, 100_000), m("c/v3-8b:free", true, 50_000), m("d/v4-5b:free", true, 40_000),
      m("e/text-120b:free", false, 300_000), m("f/text-20b:free", false, 10_000),
    ]);
    assert.deepEqual(defaultPreselection(ranked), ["a/v1-70b:free", "b/v2-30b:free", "c/v3-8b:free", "e/text-120b:free"]);
  });
  test("без vision-моделей — три лучшие текстовые, мусор не предвыбирается", () => {
    const ranked = rankAiModels("groq", [m("llama-3.3-70b-versatile"), m("openai/gpt-oss-120b"), m("qwen/qwen3-32b"), m("llama-3.1-8b-instant"), m("whisper-large-v3")]);
    assert.deepEqual(defaultPreselection(ranked), ["llama-3.3-70b-versatile", "qwen/qwen3-32b", "openai/gpt-oss-120b"]);
  });
  test("если подходящих нет, остаётся одна модель, чтобы очередь не была пустой", () => {
    assert.deepEqual(defaultPreselection(rankAiModels("custom", [m("whisper-1"), m("tts-1")])), ["tts-1"]);
  });
});

describe("ранжирование в приложении: выбор пользователя не трогается", () => {
  let db: CommandDb;
  let provider: Awaited<ReturnType<typeof startFakeProvider>>;
  let catalog: { id: string; name: string; context_length?: number; architecture?: { input_modalities: string[] } }[];
  const free = { prompt: "0", completion: "0" };
  const listing = () => ({ data: catalog.map((entry) => ({ ...entry, pricing: free })) });

  before(async () => {
    ({ db } = await createCommandDb());
    catalog = [
      { id: "z/alpha-8b:free", name: "A", context_length: 8_000 },
      { id: "google/gemma-3-27b-it:free", name: "B", context_length: 131_072, architecture: { input_modalities: ["text", "image"] } },
      { id: "meta-llama/llama-3.3-70b-instruct:free", name: "C", context_length: 131_072 },
      { id: "a/old-3b:free", name: "D", context_length: 4_000 },
      { id: "m/vision-30b:free", name: "E", context_length: 100_000, architecture: { input_modalities: ["text", "image"] } },
      { id: "n/vision-12b:free", name: "F", context_length: 90_000, architecture: { input_modalities: ["text", "image"] } },
      { id: "o/vision-9b:free", name: "G", context_length: 80_000, architecture: { input_modalities: ["text", "image"] } },
    ];
    provider = await startFakeProvider((request) => request.method === "GET" ? { body: JSON.stringify(listing()) } : chatReply("OK"));
  });
  after(async () => { await provider.close(); releaseCommandDb(); });

  const queueOf = async (ownerId: string) => (await db.select().from(schema.aiProviderModelSelections)
    .where(eq(schema.aiProviderModelSelections.ownerId, ownerId)))
    .filter((row) => row.enabled).sort((left, right) => left.sortOrder - right.sortOrder).map((row) => row.modelId);

  test("новый аккаунт: каталог по рангу, включены лучшие vision и одна текстовая, остальные известны, но выключены", async () => {
    const ownerId = (await ownerOf(db, newTelegramId())).id;
    const { models } = await connectAiProviderAccount(ownerId, { providerId: "openrouter", name: "OR", apiKey: "sk-or-v1-x" });
    assert.deepEqual(models.map((model) => model.id), [
      "google/gemma-3-27b-it:free", "m/vision-30b:free", "n/vision-12b:free", "o/vision-9b:free",
      "meta-llama/llama-3.3-70b-instruct:free", "z/alpha-8b:free", "a/old-3b:free",
    ]);
    assert.deepEqual(await queueOf(ownerId), ["google/gemma-3-27b-it:free", "m/vision-30b:free", "n/vision-12b:free", "meta-llama/llama-3.3-70b-instruct:free"]);
    const rows = await db.select().from(schema.aiProviderModelSelections).where(eq(schema.aiProviderModelSelections.ownerId, ownerId));
    assert.equal(rows.length, catalog.length, "известны все модели каталога");

    const card = (await listAiProviderCards(ownerId)).providers.find((provider) => provider.id === "openrouter")!;
    assert.deepEqual(card.models.map((model) => model.id), models.map((model) => model.id), "экран выбора показывает тот же ранг");
    assert.deepEqual(card.models.filter((model) => model.selected).map((model) => model.id).sort(), (await queueOf(ownerId)).sort());
  });

  test("сохранённые выбор и порядок пользователя не меняются ни показом списка, ни обновлением каталога", async () => {
    const ownerId = (await ownerOf(db, newTelegramId())).id;
    const { account } = await connectAiProviderAccount(ownerId, { providerId: "openrouter", name: "OR", apiKey: "sk-or-v1-y" });
    const mine = ["a/old-3b:free", "z/alpha-8b:free"];
    await setAiProviderModelQueue(ownerId, mine.map((modelId) => ({ providerId: "openrouter", modelId })));
    const before = await db.select().from(schema.aiProviderModelSelections).where(eq(schema.aiProviderModelSelections.ownerId, ownerId));

    await listAiProviderCards(ownerId);
    await refreshAiProviderAccountModels(ownerId, account.id);
    assert.deepEqual(await queueOf(ownerId), mine);
    const after = await db.select().from(schema.aiProviderModelSelections).where(eq(schema.aiProviderModelSelections.ownerId, ownerId));
    const key = (row: typeof before[number]) => `${row.modelId}:${row.enabled}:${row.sortOrder}`;
    assert.deepEqual(after.map(key).sort(), before.map(key).sort());
  });
});
