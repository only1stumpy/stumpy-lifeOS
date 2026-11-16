import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { analyzeMessage, resetQuotaCooldowns } from "../src/server/ai/analyze";
import {
  connectAiProviderAccount,
  deleteAiProviderAccount,
  listAiProviderCards,
  loadConfiguredAiProviderConfigs,
  refreshAiProviderAccountModels,
  reorderAiProviderAccount,
  setAiProviderAccountEnabled,
} from "../src/server/ai/provider-accounts";
import { AppError } from "../src/server/http";
import { createCommandDb, releaseCommandDb, newTelegramId, ownerOf, rejectsWith, type CommandDb } from "./helpers/command-db";
import { chatReply, startFakeProvider, type FakeRequest } from "./helpers/fake-provider";

// BYOK against a local HTTPS provider: what is stored, who can see it, and in what order accounts are tried.
// Hooks live inside a suite: with --test-isolation=none top-level hooks would run once for the whole process.
describe('BYOK-аккаунты ИИ', () => {
let db: CommandDb;
let provider: Awaited<ReturnType<typeof startFakeProvider>>;

const MODELS = { data: [{ id: "openai/gpt-oss-20b" }, { id: "openai/gpt-oss-120b" }, { id: "not-a-free-tier-model" }] };
const bearer = (request: FakeRequest) => String(request.headers.authorization ?? "").replace("Bearer ", "");
const okProvider = (request: FakeRequest) => request.method === "GET" ? { body: JSON.stringify(MODELS) } : chatReply("OK");

before(async () => {
  ({ db } = await createCommandDb());
  provider = await startFakeProvider(okProvider);
});
beforeEach(() => {
  provider.requests.length = 0;
  provider.setHandler(okProvider);
  resetQuotaCooldowns();
});
after(async () => { await provider.close(); releaseCommandDb(); });

async function newOwner() {
  return (await ownerOf(db, newTelegramId())).id;
}
const connect = (ownerId: string, apiKey: string, name = "Тестовый Groq") =>
  connectAiProviderAccount(ownerId, { providerId: "groq", name, apiKey, freeTierConfirmed: true });
const accountRows = (ownerId: string) => db.select().from(schema.aiProviderAccounts).where(eq(schema.aiProviderAccounts.ownerId, ownerId));

test("ключ проверяется живым запросом, хранится только зашифрованным и не попадает в ответ", async () => {
  const ownerId = await newOwner();
  const { account, models } = await connect(ownerId, "fake-key-one");

  assert.deepEqual(models.map((model) => model.id).sort(), ["openai/gpt-oss-120b", "openai/gpt-oss-20b"], "в каталоге остаются только бесплатные модели");
  assert.ok(provider.requests.length >= 2, "каталог и тестовый запрос");
  assert.ok(provider.requests.every((request) => bearer(request) === "fake-key-one"));
  assert.ok(provider.requests.some((request) => request.method === "POST" && request.path.endsWith("/chat/completions")));

  const [row] = await accountRows(ownerId);
  assert.match(row!.encryptedApiKey, /^v1:/);
  assert.doesNotMatch(row!.encryptedApiKey, /fake-key-one/);
  assert.equal(row!.freeTierConfirmed, true);
  assert.doesNotMatch(JSON.stringify(account), /fake-key-one|encrypted/i);
  const cards = await listAiProviderCards(ownerId);
  assert.doesNotMatch(JSON.stringify(cards), /fake-key-one|v1:/);
  assert.equal(cards.providers.find((card) => card.id === "groq")?.accounts.length, 1);
  assert.equal((await loadConfiguredAiProviderConfigs(ownerId))[0]?.apiKey, "fake-key-one", "для запроса ключ расшифровывается");
});

test("без подтверждения Free Tier ключ не принимается и провайдеру не уходит ни одного запроса", async () => {
  const ownerId = await newOwner();
  for (const freeTierConfirmed of [undefined, false, "true", 1]) {
    await assert.rejects(connectAiProviderAccount(ownerId, { providerId: "groq", name: "G", apiKey: "fake-key", ...(freeTierConfirmed === undefined ? {} : { freeTierConfirmed }) }), `confirmed=${String(freeTierConfirmed)}`);
  }
  assert.equal(provider.requests.length, 0);
  assert.equal((await accountRows(ownerId)).length, 0);
});

test("отклонённый ключ или неудачный тестовый запрос ничего не сохраняют", async () => {
  const ownerId = await newOwner();
  provider.setHandler(() => ({ status: 401, body: '{"error":{"code":"invalid_api_key"}}' }));
  await rejectsWith(connect(ownerId, "fake-bad-key"), 400);
  provider.setHandler((request) => request.method === "GET" ? { body: JSON.stringify(MODELS) } : { status: 401, body: '{"error":{"code":"invalid_api_key"}}' });
  await rejectsWith(connect(ownerId, "fake-bad-key"), 400);
  assert.equal((await accountRows(ownerId)).length, 0);
  assert.equal((await db.select().from(schema.aiProviderModelSelections).where(eq(schema.aiProviderModelSelections.ownerId, ownerId))).length, 0);
});

test("отключённый провайдер и небезопасный endpoint отклоняются до сети", async () => {
  const ownerId = await newOwner();
  await rejectsWith(connectAiProviderAccount(ownerId, { providerId: "cerebras", name: "C", apiKey: "fake-key", freeTierConfirmed: true }), 400);
  for (const endpoint of ["http://api.example.com/v1", "https://127.0.0.1/v1", "https://169.254.169.254/v1"]) {
    await assert.rejects(connectAiProviderAccount(ownerId, { providerId: "custom", name: "X", apiKey: "fake-key", endpoint, model: "m", freeTierConfirmed: true }), endpoint);
  }
  assert.equal(provider.requests.length, 0);
  assert.equal((await accountRows(ownerId)).length, 0);
});

test("замена ключа: после удаления и повторного подключения запросы идут только с новым ключом", async () => {
  const ownerId = await newOwner();
  const { account } = await connect(ownerId, "fake-old-key");
  await deleteAiProviderAccount(ownerId, account.id);
  assert.equal((await loadConfiguredAiProviderConfigs(ownerId)).length, 0);
  await connect(ownerId, "fake-new-key");

  provider.requests.length = 0;
  provider.setHandler(() => chatReply(JSON.stringify({ entries: [], clarification: "Что именно записать?" })));
  const result = await analyzeMessage({ text: "что-то", timeZone: "UTC", now: "2026-03-10T12:00:00.000Z" }, { profiles: await loadConfiguredAiProviderConfigs(ownerId) });
  assert.equal(result.clarification, "Что именно записать?");
  assert.deepEqual([...new Set(provider.requests.map(bearer))], ["fake-new-key"]);
});

test("изоляция: чужой аккаунт не виден, не удаляется, не включается, не переставляется и не обновляется", async () => {
  const ownerA = await newOwner();
  const ownerB = await newOwner();
  const { account } = await connect(ownerA, "fake-key-a");
  await connect(ownerB, "fake-key-b");

  const cardsB = await listAiProviderCards(ownerB);
  assert.deepEqual(cardsB.providers.flatMap((card) => card.accounts.map((a) => a.id)).filter((id) => id === account.id), []);
  const configsB = await loadConfiguredAiProviderConfigs(ownerB);
  assert.ok(configsB.length > 0 && configsB.every((config) => config.accountId !== account.id && config.apiKey === "fake-key-b"));

  provider.requests.length = 0;
  for (const attempt of [
    () => deleteAiProviderAccount(ownerB, account.id),
    () => setAiProviderAccountEnabled(ownerB, account.id, false),
    () => setAiProviderAccountEnabled(ownerB, account.id, true),
    () => reorderAiProviderAccount(ownerB, account.id, 0),
    () => refreshAiProviderAccountModels(ownerB, account.id),
  ]) await rejectsWith(attempt(), 404);
  assert.equal(provider.requests.length, 0, "ключ владельца A не использован для запроса B");
  const [still] = await db.select().from(schema.aiProviderAccounts).where(eq(schema.aiProviderAccounts.id, account.id));
  assert.equal(still?.enabled, true);
  assert.equal(still?.ownerId, ownerA);
});

test("порядок fallback: аккаунты пробуются по своему порядку, при сбое — следующий, перестановка и отключение учитываются", async () => {
  const ownerId = await newOwner();
  const first = (await connect(ownerId, "fake-key-first")).account;
  const second = (await connect(ownerId, "fake-key-second")).account;
  const keysInOrder = async () => [...new Set((await loadConfiguredAiProviderConfigs(ownerId)).map((config) => config.apiKey))];
  assert.deepEqual(await keysInOrder(), ["fake-key-first", "fake-key-second"]);

  // The first account fails: the answer comes from the second, and the attempts are in order.
  provider.requests.length = 0;
  provider.setHandler((request) => bearer(request) === "fake-key-first" ? { status: 503, body: "{}" } : chatReply(JSON.stringify({ entries: [], clarification: "Уточни сумму." })));
  const result = await analyzeMessage({ text: "кофе", timeZone: "UTC", now: "2026-03-10T12:00:00.000Z" }, { profiles: await loadConfiguredAiProviderConfigs(ownerId), ownerId });
  assert.equal(result.clarification, "Уточни сумму.");
  assert.deepEqual(provider.requests.map(bearer).slice(0, 2), ["fake-key-first", "fake-key-second"]);
  const usage = await db.select().from(schema.aiProviderUsageEvents).where(eq(schema.aiProviderUsageEvents.accountId, first.id));
  assert.ok(usage.some((event) => event.outcome === "failure" && event.failureKind === "unavailable"), "сбой записан в использование");

  await reorderAiProviderAccount(ownerId, second.id, 0);
  assert.deepEqual(await keysInOrder(), ["fake-key-second", "fake-key-first"]);
  await setAiProviderAccountEnabled(ownerId, second.id, false);
  assert.deepEqual(await keysInOrder(), ["fake-key-first"]);
});

test("когда все аккаунты недоступны, пользователь получает понятную ошибку без ответа провайдера", async () => {
  const ownerId = await newOwner();
  await connect(ownerId, "fake-key-only");
  provider.setHandler(() => ({ status: 503, body: "provider private body fake-key-only" }));
  await assert.rejects(
    analyzeMessage({ text: "кофе", timeZone: "UTC", now: "2026-03-10T12:00:00.000Z" }, { profiles: await loadConfiguredAiProviderConfigs(ownerId), ownerId }),
    (error: unknown) => !(error instanceof AppError) && error instanceof Error && !/private body|fake-key-only/.test(error.message),
  );
});
});
