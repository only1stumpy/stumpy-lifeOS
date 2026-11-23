import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import { eq } from "drizzle-orm";
import { connectAiProviderAccount } from "../src/server/ai/provider-accounts";
import * as schema from "../src/db/schema";
import {
  codeChallengeFor,
  completeOpenRouterOAuth,
  generatePkce,
  getOpenRouterOAuthStatus,
  miniAppReturnLink,
  resetBotUsernameCache,
  startOpenRouterOAuth,
} from "../src/server/ai/openrouter-oauth";
import { GET as callbackGet } from "../src/app/api/ai/oauth/openrouter/callback/route";
import { createCommandDb, newTelegramId, ownerOf, releaseCommandDb, rejectsWith, type CommandDb } from "./helpers/command-db";
import { chatReply, startFakeProvider, type FakeRequest } from "./helpers/fake-provider";

// OpenRouter OAuth PKCE against mocks: real OpenRouter is never contacted.
describe("OpenRouter OAuth PKCE", () => {
  let db: CommandDb;
  let provider: Awaited<ReturnType<typeof startFakeProvider>>;
  const realFetch = globalThis.fetch;
  const realAppUrl = process.env.APP_URL;
  let exchanges: { url: string; body: Record<string, string> }[];
  let exchangeReply: () => Response;
  let getMeReply: () => Response;

  const MODELS = { data: [{ id: "meta/llama:free", name: "Llama", pricing: { prompt: "0", completion: "0" } }] };
  const okProvider = (request: FakeRequest) => request.method === "GET" ? { body: JSON.stringify(MODELS) } : chatReply("OK");
  const accountRows = (ownerId: string) => db.select().from(schema.aiProviderAccounts).where(eq(schema.aiProviderAccounts.ownerId, ownerId));
  const stateOf = (authUrl: string) => new URL(authUrl).searchParams.get("state")!;
  const goodKey = () => Response.json({ key: "sk-or-v1-secret-oauth-key", user_id: "user_1" });

  before(async () => {
    ({ db } = await createCommandDb());
    provider = await startFakeProvider(okProvider);
  });
  beforeEach(() => {
    process.env.APP_URL = "https://lifeos.example/";
    exchanges = [];
    exchangeReply = goodKey;
    getMeReply = () => Response.json({ ok: true, result: { username: "lifeos_preview_bot" } });
    process.env.TELEGRAM_BOT_TOKEN = "123456:test-token";
    delete process.env.TELEGRAM_MINIAPP_NAME;
    resetBotUsernameCache();
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://api.telegram.org/")) return getMeReply();
      if (!url.startsWith("https://openrouter.ai/api/v1/auth/keys")) return realFetch(input, init);
      exchanges.push({ url, body: JSON.parse(String(init?.body)) as Record<string, string> });
      return exchangeReply();
    }) as typeof fetch;
  });
  afterEach(() => { globalThis.fetch = realFetch; });
  after(async () => {
    if (realAppUrl === undefined) delete process.env.APP_URL; else process.env.APP_URL = realAppUrl;
    await provider.close();
    releaseCommandDb();
  });

  const newOwner = async () => (await ownerOf(db, newTelegramId())).id;

  test("PKCE: challenge — base64url(SHA-256(verifier)), по вектору из RFC 7636", () => {
    assert.equal(codeChallengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    const { verifier, challenge } = generatePkce();
    assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(challenge, createHash("sha256").update(verifier).digest("base64url"));
    assert.notEqual(generatePkce().verifier, verifier);
  });

  test("старт: ссылка по документации, verifier не покидает сервер и лежит зашифрованным", async () => {
    const ownerId = await newOwner();
    const { id, authUrl } = await startOpenRouterOAuth(ownerId, "Личный");
    const url = new URL(authUrl);
    assert.equal(`${url.origin}${url.pathname}`, "https://openrouter.ai/auth");
    assert.equal(url.searchParams.get("callback_url"), "https://lifeos.example/api/ai/oauth/openrouter/callback");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.ok(url.searchParams.get("code_challenge"));
    assert.ok(stateOf(authUrl).length >= 30);

    const [row] = await db.select().from(schema.aiOauthSessions).where(eq(schema.aiOauthSessions.id, id));
    assert.equal(row!.ownerId, ownerId);
    assert.equal(row!.status, "pending");
    assert.match(row!.encryptedCodeVerifier, /^v1:/);
    assert.notEqual(row!.stateHash, stateOf(authUrl), "в БД только хэш state");
    assert.ok(!authUrl.includes(row!.encryptedCodeVerifier));
    assert.ok(row!.expiresAt.getTime() - Date.now() <= 10 * 60 * 1000);
  });

  test("без https APP_URL вход недоступен, ручной ввод остаётся", async () => {
    process.env.APP_URL = "http://insecure.example/";
    await rejectsWith(startOpenRouterOAuth(await newOwner(), "X"), 503);
  });

  test("успех: код обменивается с verifier, ключ сохраняется как обычный и не отдаётся наружу", async () => {
    const ownerId = await newOwner();
    const { id, authUrl } = await startOpenRouterOAuth(ownerId, "Личный");
    const challenge = new URL(authUrl).searchParams.get("code_challenge")!;

    const outcome = await completeOpenRouterOAuth({ state: stateOf(authUrl), code: "auth_code_1" });
    assert.deepEqual(outcome, { ok: true });

    assert.equal(exchanges.length, 1);
    assert.equal(exchanges[0]!.url, "https://openrouter.ai/api/v1/auth/keys");
    assert.equal(exchanges[0]!.body.code, "auth_code_1");
    assert.equal(exchanges[0]!.body.code_challenge_method, "S256");
    assert.equal(codeChallengeFor(exchanges[0]!.body.code_verifier!), challenge, "verifier соответствует challenge из ссылки");

    const [account] = await accountRows(ownerId);
    assert.equal(account!.providerId, "openrouter");
    assert.equal(account!.name, "Личный");
    assert.equal(account!.freeTierConfirmed, true);
    assert.match(account!.encryptedApiKey, /^v1:/);
    assert.doesNotMatch(account!.encryptedApiKey, /secret-oauth-key/);
    assert.ok(provider.requests.every((request) => String(request.headers.authorization) === "Bearer sk-or-v1-secret-oauth-key"));

    const status = await getOpenRouterOAuthStatus(ownerId, id);
    assert.deepEqual(status, { status: "done" });
    assert.doesNotMatch(JSON.stringify(status), /secret-oauth-key/);
    const [row] = await db.select().from(schema.aiOauthSessions).where(eq(schema.aiOauthSessions.id, id));
    assert.equal(row!.encryptedCodeVerifier, "", "verifier стёрт после использования");
  });

  test("повторное использование state не создаёт второй аккаунт и не ходит в OpenRouter", async () => {
    const ownerId = await newOwner();
    const { authUrl } = await startOpenRouterOAuth(ownerId, "Один");
    assert.equal((await completeOpenRouterOAuth({ state: stateOf(authUrl), code: "c1" })).ok, true);
    const again = await completeOpenRouterOAuth({ state: stateOf(authUrl), code: "c2" });
    assert.equal(again.ok, false);
    assert.equal(exchanges.length, 1);
    assert.equal((await accountRows(ownerId)).length, 1);
  });

  test("чужой, выдуманный и пустой state отклоняются без обмена", async () => {
    const ownerId = await newOwner();
    await startOpenRouterOAuth(ownerId, "Один");
    for (const state of ["forged-state", "", null, "x".repeat(500)]) {
      const outcome = await completeOpenRouterOAuth({ state, code: "c" });
      assert.equal(outcome.ok, false);
    }
    assert.equal(exchanges.length, 0);
    assert.equal((await accountRows(ownerId)).length, 0);
  });

  test("истёкший state отклоняется, статус — expired", async () => {
    const ownerId = await newOwner();
    const { id, authUrl } = await startOpenRouterOAuth(ownerId, "Один");
    await db.update(schema.aiOauthSessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.aiOauthSessions.id, id));
    assert.equal((await completeOpenRouterOAuth({ state: stateOf(authUrl), code: "c" })).ok, false);
    assert.equal(exchanges.length, 0);
    assert.deepEqual(await getOpenRouterOAuthStatus(ownerId, id), { status: "expired" });
  });

  test("статус виден только владельцу попытки", async () => {
    const ownerId = await newOwner();
    const { id } = await startOpenRouterOAuth(ownerId, "Один");
    await rejectsWith(getOpenRouterOAuthStatus(await newOwner(), id), 404);
  });

  test("ключ достаётся владельцу state, а не тому, кто открыл callback", async () => {
    const alice = await newOwner();
    const bob = await newOwner();
    const { authUrl } = await startOpenRouterOAuth(alice, "Alice");
    await startOpenRouterOAuth(bob, "Bob");
    assert.equal((await completeOpenRouterOAuth({ state: stateOf(authUrl), code: "c" })).ok, true);
    assert.equal((await accountRows(alice)).length, 1);
    assert.equal((await accountRows(bob)).length, 0);
  });

  test("отказ пользователя: попытка отменяется, ключа нет, сообщение понятное", async () => {
    const ownerId = await newOwner();
    const { id, authUrl } = await startOpenRouterOAuth(ownerId, "Один");
    const outcome = await completeOpenRouterOAuth({ state: stateOf(authUrl), code: null, error: "access_denied" });
    assert.equal(outcome.ok, false);
    assert.match((outcome as { message: string }).message, /вручную/);
    assert.equal((await getOpenRouterOAuthStatus(ownerId, id)).status, "cancelled");
    assert.equal(exchanges.length, 0);
  });

  test("OpenRouter отклонил код: попытка failed, аккаунт не создан", async () => {
    exchangeReply = () => Response.json({ error: { code: 400, message: "bad" } }, { status: 400 });
    const ownerId = await newOwner();
    const { id, authUrl } = await startOpenRouterOAuth(ownerId, "Один");
    const outcome = await completeOpenRouterOAuth({ state: stateOf(authUrl), code: "bad" });
    assert.equal(outcome.ok, false);
    const status = await getOpenRouterOAuthStatus(ownerId, id);
    assert.equal(status.status, "failed");
    assert.ok(status.error);
    assert.equal((await accountRows(ownerId)).length, 0);
  });

  test("новая попытка отменяет прежнюю незавершённую", async () => {
    const ownerId = await newOwner();
    const first = await startOpenRouterOAuth(ownerId, "Один");
    const second = await startOpenRouterOAuth(ownerId, "Два");
    assert.equal((await getOpenRouterOAuthStatus(ownerId, first.id)).status, "cancelled");
    assert.equal((await completeOpenRouterOAuth({ state: stateOf(first.authUrl), code: "c" })).ok, false);
    assert.equal((await getOpenRouterOAuthStatus(ownerId, second.id)).status, "pending");
  });

  test("ссылка возврата: бот из getMe, необязательное имя Mini App, запасной вариант — APP_URL", async () => {
    assert.equal(await miniAppReturnLink(), "https://t.me/lifeos_preview_bot?startapp=oauth");
    process.env.TELEGRAM_MINIAPP_NAME = "app";
    assert.equal(await miniAppReturnLink(), "https://t.me/lifeos_preview_bot/app?startapp=oauth");
    resetBotUsernameCache();
    getMeReply = () => Response.json({ ok: false });
    assert.equal(await miniAppReturnLink(), "https://lifeos.example/");
  });

  test("страница callback: после успеха автопереход и большая кнопка, при отказе только кнопка", async () => {
    const ownerId = await newOwner();
    const { authUrl } = await startOpenRouterOAuth(ownerId, "Личный");
    const ok = await callbackGet(new Request(`https://lifeos.example/api/ai/oauth/openrouter/callback?code=c&state=${stateOf(authUrl)}`));
    const okHtml = await ok.text();
    assert.equal(ok.status, 200);
    assert.match(okHtml, /window\.close\(\)/);
    assert.match(okHtml, /location\.href="https:\/\/t\.me\/lifeos_preview_bot\?startapp=oauth"/);
    assert.match(okHtml, /setTimeout\(lifeosBack,500\)/);
    assert.match(okHtml, /class="back" href="https:\/\/t\.me\/lifeos_preview_bot\?startapp=oauth" onclick="return lifeosBack\(\)">Закрыть и вернуться/);
    assert.doesNotMatch(okHtml, /secret-oauth-key/);

    const bad = await callbackGet(new Request("https://lifeos.example/api/ai/oauth/openrouter/callback?code=c&state=forged"));
    const badHtml = await bad.text();
    assert.equal(bad.status, 400);
    assert.doesNotMatch(badHtml, /setTimeout\(lifeosBack,500\)/);
    assert.match(badHtml, /Закрыть и вернуться/);
  });

  test("OpenRouter без подтверждения тарифа: сохраняются только бесплатные модели, платные не попадают ни в каталог, ни в очередь", async () => {
    provider.setHandler((request) => request.method === "GET"
      ? { body: JSON.stringify({ data: [
        { id: "meta/llama:free", name: "Free", pricing: { prompt: "0", completion: "0" } },
        { id: "vendor/paid-model", name: "Paid", pricing: { prompt: "0.000001", completion: "0.000002" } },
        { id: "vendor/trap:free", name: "Paid under a :free name", pricing: { prompt: "0.000001", completion: "0" } },
        { id: "vendor/zero-but-not-free", name: "Zero price, no suffix", pricing: { prompt: "0", completion: "0" } },
      ] }) }
      : chatReply("OK"));
    try {
      const ownerId = await newOwner();
      const { models } = await connectAiProviderAccount(ownerId, { providerId: "openrouter", name: "Без галочки", apiKey: "sk-or-v1-x" });
      assert.deepEqual(models.map((model) => model.id), ["meta/llama:free"]);
      const [account] = await accountRows(ownerId);
      assert.deepEqual(account!.models.map((model) => model.id), ["meta/llama:free"]);
      const queue = await db.select().from(schema.aiProviderModelSelections).where(eq(schema.aiProviderModelSelections.ownerId, ownerId));
      assert.deepEqual(queue.map((item) => item.modelId), ["meta/llama:free"]);
      const chats = provider.requests.filter((request) => request.method === "POST").map((request) => JSON.parse(request.body).model);
      assert.ok(chats.every((model: string) => model === "meta/llama:free"), "тестовый запрос идёт только в бесплатную модель");
    } finally {
      provider.setHandler(okProvider);
    }
  });
});
