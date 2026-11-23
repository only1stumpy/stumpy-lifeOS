import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { ensureOwner } from "../src/server/lifeos";
import { withTelegramUser } from "../src/server/owner-context";
import { encryptProviderApiKey } from "../src/server/ai/provider-profiles";
import { getSummaryAdvice } from "../src/server/ai/summary-advice";
import type { PeriodReport } from "../src/domain/period-report";
import { createCommandDb, newTelegramId, releaseCommandDb, type CommandDb } from "./helpers/command-db";
import { chatReply, startFakeProvider } from "./helpers/fake-provider";

const REPORT: PeriodReport = {
  period: "week",
  start: "2026-11-16",
  end: "2026-11-22",
  currency: "MDL",
  nutrition: {
    total: { calories: 6_300, proteinGrams: 420, fatGrams: 210, carbsGrams: 690 },
    average: { calories: 2_100, proteinGrams: 140, fatGrams: 70, carbsGrams: 230 },
    loggedDays: 3,
    target: null,
    days: [{ date: "2026-11-16", calories: 2_000 }],
  },
  weight: { first: 70, last: 69.5, change: -0.5, points: [{ date: "2026-11-16", weightKg: 70 }, { date: "2026-11-22", weightKg: 69.5 }] },
  finance: {
    expenseMinor: 120_000,
    incomeMinor: 250_000,
    expenses: [
      { name: "Частная категория 83f2", amountMinor: 80_000 },
      { name: "Другая частная категория 83f2", amountMinor: 40_000 },
    ],
    incomes: [
      { name: "Имя клиента 83f2", amountMinor: 200_000 },
      { name: "Другой клиент 83f2", amountMinor: 50_000 },
    ],
  },
  gym: { workouts: 2, sets: 18, volumeKg: 900 },
};

async function dbFor(t: TestContext) {
  const state = await createCommandDb();
  t.after(async () => {
    releaseCommandDb();
    await state.client.close();
  });
  const telegramId = newTelegramId();
  const owner = await withTelegramUser(telegramId, () => ensureOwner());
  return { ...state, owner };
}

async function addMockProvider(db: CommandDb, ownerId: string, endpoint: string) {
  await db.update(schema.ownerSettings).set({ aiModelQueueInitialized: true }).where(eq(schema.ownerSettings.id, ownerId));
  const [account] = await db.insert(schema.aiProviderAccounts).values({
    ownerId,
    providerId: "custom",
    name: "Mock provider",
    endpoint,
    authHeaderName: "authorization",
    encryptedApiKey: encryptProviderApiKey("mock-test-key"),
    freeTierConfirmed: true,
    enabled: true,
    sortOrder: 0,
    models: [{ id: "mock-model", name: "Mock model", supportsImages: false, contextLength: null, freeRequestsPerDay: null, freeRequestsPerMinute: null, freeTokensPerMinute: null }],
  }).returning();
  assert.ok(account);
  await db.insert(schema.aiProviderModelSelections).values({
    ownerId,
    providerId: "custom",
    modelId: "mock-model",
    enabled: true,
    sortOrder: 0,
  });
}

test("summary advice uses anonymous aggregate numbers and caches per owner and report window", async (t) => {
  const { db, owner } = await dbFor(t);
  const firstItems = ["Среднее питание видно только за три дня — добавь записи ещё за пару дней для сравнения."];
  const provider = await startFakeProvider(() => chatReply(JSON.stringify({ items: firstItems })));
  t.after(() => provider.close());
  await addMockProvider(db, owner.id, "https://summary-provider.mock/v1");

  const result = await getSummaryAdvice(owner.id, REPORT);
  assert.deepEqual(result, { advice: { items: firstItems }, adviceError: null });
  assert.equal(provider.requests.length, 1);
  const requestBody = JSON.parse(provider.requests[0]!.body) as { messages: { role: string; content: string }[] };
  const sentPrompt = requestBody.messages.find((message) => message.role === "user")?.content ?? "";
  assert.match(sentPrompt, /expenseMinor/);
  assert.match(sentPrompt, /expenseCategoryTotals\":\[80000,40000\]/);
  assert.match(sentPrompt, /incomeCategoryTotals\":\[200000,50000\]/);
  assert.doesNotMatch(sentPrompt, /Частная категория|Имя клиента|Другой клиент|83f2|2026-11-16/);

  const [cached] = await db.select().from(schema.summaryAdviceCache).where(eq(schema.summaryAdviceCache.ownerId, owner.id));
  assert.deepEqual(cached?.advice, { items: firstItems });
  assert.deepEqual(await getSummaryAdvice(owner.id, REPORT), result);
  assert.equal(provider.requests.length, 1, "cached advice avoids another provider call");

  const otherWindow = { ...REPORT, start: "2026-11-09", end: "2026-11-15" };
  provider.setHandler(() => chatReply(JSON.stringify({ items: ["В предыдущем периоде записей было меньше для сравнения."] })));
  const separateWindow = await getSummaryAdvice(owner.id, otherWindow);
  assert.match(separateWindow.advice?.items[0] ?? "", /предыдущем периоде/);
  assert.equal(provider.requests.length, 2, "different period bounds use a different cache row");

  const retried = await getSummaryAdvice(owner.id, REPORT, { retry: true });
  assert.deepEqual(retried, result, "retry returns the cached success without spending provider quota");
  assert.equal(provider.requests.length, 2);

  const otherOwner = await withTelegramUser(newTelegramId(), () => ensureOwner());
  const isolated = await getSummaryAdvice(otherOwner.id, REPORT);
  assert.equal(isolated.advice, null);
  assert.ok(isolated.adviceError);
  assert.equal(provider.requests.length, 2, "another owner cannot read this owner's cache");
});

test("summary advice returns safe provider errors without changing report data", async (t) => {
  const { db, owner } = await dbFor(t);
  const provider = await startFakeProvider(() => ({ status: 429, body: "private provider response and mock-test-key" }));
  t.after(() => provider.close());
  await addMockProvider(db, owner.id, "https://summary-error.mock/v1");

  const result = await getSummaryAdvice(owner.id, REPORT);
  assert.equal(result.advice, null);
  assert.match(result.adviceError ?? "", /лимит запросов/i);
  assert.doesNotMatch(result.adviceError ?? "", /private provider response|mock-test-key/);
  assert.equal(REPORT.finance?.expenseMinor, 120_000);
  assert.equal((await db.select().from(schema.summaryAdviceCache)).length, 0);
});

test("summary advice without a configured key returns a safe error", async (t) => {
  const { owner } = await dbFor(t);
  const result = await getSummaryAdvice(owner.id, REPORT);
  assert.equal(result.advice, null);
  assert.match(result.adviceError ?? "", /ИИ не подключён/i);
});

test("invalid advice schema is rejected and is not cached", async (t) => {
  const { db, owner } = await dbFor(t);
  const provider = await startFakeProvider(() => chatReply(JSON.stringify({ items: ["short"], extra: true })));
  t.after(() => provider.close());
  await addMockProvider(db, owner.id, "https://summary-invalid.mock/v1");

  const result = await getSummaryAdvice(owner.id, REPORT);
  assert.equal(result.advice, null);
  assert.match(result.adviceError ?? "", /неразборчивый ответ/i);
  assert.equal((await db.select().from(schema.summaryAdviceCache)).length, 0);
});
