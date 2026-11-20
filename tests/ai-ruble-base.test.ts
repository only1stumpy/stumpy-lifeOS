import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { anchorRubleToBase } from "../src/domain/currencies";
import { analyzeMessage, resetQuotaCooldowns } from "../src/server/ai/analyze";
import { connectAiProviderAccount, loadConfiguredAiProviderConfigs } from "../src/server/ai/provider-accounts";
import { createCommandDb, releaseCommandDb, newTelegramId, ownerOf, type CommandDb } from "./helpers/command-db";
import { chatReply, startFakeProvider } from "./helpers/fake-provider";

// F24: the model answers RUB for «рублей»; for an owner whose base is PRB the draft must stay in PRB.
describe("рубль в сообщении и основная валюта", () => {
  let db: CommandDb;
  let provider: Awaited<ReturnType<typeof startFakeProvider>>;
  const MODELS = { data: [{ id: "openai/gpt-oss-20b" }, { id: "openai/gpt-oss-120b" }] };

  before(async () => {
    ({ db } = await createCommandDb());
    provider = await startFakeProvider((request) => request.method === "GET" ? { body: JSON.stringify(MODELS) } : chatReply("OK"));
  });
  beforeEach(() => resetQuotaCooldowns());
  after(async () => { await provider.close(); releaseCommandDb(); });

  /** Runs the message through the fake model that always answers with `modelCurrency`. */
  async function currencyOf(text: string, baseCurrency: string, modelCurrency: string) {
    const ownerId = (await ownerOf(db, newTelegramId())).id;
    provider.setHandler((request) => request.method === "GET" ? { body: JSON.stringify(MODELS) } : chatReply("OK"));
    await connectAiProviderAccount(ownerId, { providerId: "groq", name: "G", apiKey: "fake-key", freeTierConfirmed: true });
    provider.setHandler(() => chatReply(JSON.stringify({
      entries: [{ food: null, money: { label: "Переходник", amountMinor: 41_300, currency: modelCurrency, kind: "expense", category: "Прочее" }, occurredAt: "2026-11-20T10:00:00.000Z" }],
      clarification: null,
    })));
    const result = await analyzeMessage({ text, timeZone: "UTC", now: "2026-11-20T10:00:00.000Z", baseCurrency }, { profiles: await loadConfiguredAiProviderConfigs(ownerId), ownerId });
    return result.entries[0]!.money!.currency;
  }

  test("основная PRB: «413 рублей переходник» и ответ модели RUB дают PRB", async () => {
    assert.equal(await currencyOf("413 рублей переходник", "PRB", "RUB"), "PRB");
  });
  test("основная RUB: ответ модели PRB для «руб.» дают RUB", async () => {
    assert.equal(await currencyOf("переходник 413 руб.", "RUB", "PRB"), "RUB");
  });
  test("явные валюты не подменяются", async () => {
    assert.equal(await currencyOf("20 евро кофе", "PRB", "EUR"), "EUR");
    assert.equal(await currencyOf("100 долларов кофе", "PRB", "USD"), "USD");
    assert.equal(await currencyOf("15 российских рублей кофе", "PRB", "RUB"), "RUB");
    assert.equal(await currencyOf("15 RUB кофе", "PRB", "RUB"), "RUB");
  });
  test("основная USD: рубли не подменяются (вопрос про рубли задаёт бот)", () => {
    assert.equal(anchorRubleToBase("100 руб", "RUB", "USD"), "RUB");
    assert.equal(anchorRubleToBase("100 руб", "USD", "PRB"), "USD");
  });
});
