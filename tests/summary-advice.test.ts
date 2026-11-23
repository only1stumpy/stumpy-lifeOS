import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { ensureOwner } from "../src/server/lifeos";
import { withTelegramUser } from "../src/server/owner-context";
import { encryptProviderApiKey } from "../src/server/ai/provider-profiles";
import { buildAdvicePayload, getSummaryAdvice, prefetchSummaryAdvice, previousPeriodStart, readCachedSummaryAdvice, weightTrend } from "../src/server/ai/summary-advice";
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
  // Money goes in whole currency units (not minor units) with the category names the person chose; no operation names or dates of entries.
  assert.match(sentPrompt, /"expenses":1200/);
  assert.match(sentPrompt, /"incomes":2500/);
  assert.match(sentPrompt, /"topExpenseCategories":\[\{"category":"Частная категория 83f2","amount":800\}/);
  assert.match(sentPrompt, /"incomeMayBeIrregular":true/);
  assert.match(sentPrompt, /"trend":"losing"/);
  assert.doesNotMatch(sentPrompt, /expenseMinor|amountMinor/);
  assert.equal(sentPrompt.includes(String(owner.telegramUserId)), false, "no Telegram id goes to the provider");

  const [cached] = await db.select().from(schema.summaryAdviceCache).where(eq(schema.summaryAdviceCache.ownerId, owner.id));
  assert.deepEqual(cached?.advice, { v: 2, items: firstItems });
  assert.deepEqual(await getSummaryAdvice(owner.id, REPORT), result);
  assert.equal(provider.requests.length, 1, "cached advice avoids another provider call");

  const otherWindow = { ...REPORT, start: "2026-11-09", end: "2026-11-15" };
  provider.setHandler(() => chatReply(JSON.stringify({ items: ["В предыдущем периоде записей было меньше для сравнения."] })));
  const separateWindow = await getSummaryAdvice(owner.id, otherWindow);
  assert.match(separateWindow.advice?.items[0] ?? "", /предыдущем периоде/);
  assert.equal(provider.requests.length, 2, "different period bounds use a different cache row");

  assert.deepEqual(await readCachedSummaryAdvice(owner.id, REPORT), { items: firstItems });
  assert.equal(await readCachedSummaryAdvice(owner.id, { ...REPORT, start: "2026-11-02", end: "2026-11-08" }), null, "cache read never calls the provider");
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

test("advice cached by an older prompt version is ignored and regenerated", async (t) => {
  const { db, owner } = await dbFor(t);
  await db.insert(schema.summaryAdviceCache).values({
    ownerId: owner.id, period: REPORT.period, start: REPORT.start, end: REPORT.end,
    advice: { items: ["Расходы ~162 950 мин. сильно превышают доход (140 мин.)."] },
  });
  assert.equal(await readCachedSummaryAdvice(owner.id, REPORT), null);
  const provider = await startFakeProvider(() => chatReply(JSON.stringify({ items: ["Новый совет по сумме в основных единицах валюты."] })));
  t.after(() => provider.close());
  await addMockProvider(db, owner.id, "https://summary-version.mock/v1");
  const result = await getSummaryAdvice(owner.id, REPORT);
  assert.match(result.advice?.items[0] ?? "", /Новый совет/);
  assert.equal(provider.requests.length, 1);
});

test("prefetch prepares advice for the page, never throws and does not wait forever", async (t) => {
  const { db, owner } = await dbFor(t);
  const provider = await startFakeProvider(() => chatReply(JSON.stringify({ items: ["Совет подготовлен заранее, вместе со сводкой."] })));
  t.after(() => provider.close());
  await addMockProvider(db, owner.id, "https://summary-prefetch.mock/v1");
  await prefetchSummaryAdvice(owner.id, REPORT);
  assert.deepEqual(await readCachedSummaryAdvice(owner.id, REPORT), { items: ["Совет подготовлен заранее, вместе со сводкой."] });

  // Without a configured key (or on any failure) prefetch just returns: the summary message goes out either way.
  const { owner: keyless } = await dbFor(t);
  await prefetchSummaryAdvice(keyless.id, REPORT, 50);
  assert.equal(await readCachedSummaryAdvice(keyless.id, REPORT), null);
});

test("period helpers: previous period start and weight trend noise", () => {
  assert.equal(previousPeriodStart("day", "2026-11-22"), "2026-11-21");
  assert.equal(previousPeriodStart("week", "2026-11-16"), "2026-11-09");
  assert.equal(previousPeriodStart("month", "2026-12-01"), "2026-11-01");
  assert.equal(previousPeriodStart("month", "2026-01-01"), "2025-12-01");
  assert.equal(weightTrend("week", 0.2, 3), "stable");
  assert.equal(weightTrend("week", 0.4, 3), "gaining");
  assert.equal(weightTrend("week", -0.4, 3), "losing");
  assert.equal(weightTrend("month", 0.5, 4), "stable");
  assert.equal(weightTrend("week", 1, 1), null, "one measurement is not a trend");
  assert.equal(weightTrend("week", null, 0), null);
});

test("advice payload: whole units, balance, goal, trend and previous period", () => {
  const previous: PeriodReport = { ...REPORT, start: "2026-11-09", end: "2026-11-15", finance: { expenseMinor: 90_000, incomeMinor: 0, expenses: [{ name: "Еда", amountMinor: 90_000 }], incomes: [] }, weight: undefined };
  const payload = buildAdvicePayload({ report: REPORT, previous, goalType: "gain_mass", totalBalanceMinor: 543_210, totalBalancePartial: false });
  assert.equal(payload.goal, "gain_mass");
  assert.equal(payload.finance?.expenses, 1200);
  assert.equal(payload.finance?.accountsTotalBalance, 5432.1);
  assert.equal(payload.finance?.accountsTotalBalanceIsPartial, false);
  assert.equal(payload.weight?.trend, "losing");
  assert.equal(payload.previousPeriod?.expenses, 900);
  assert.equal(payload.previousPeriod?.start, "2026-11-09");
  const noBalance = buildAdvicePayload({ report: { ...REPORT, finance: undefined }, previous: null, goalType: null, totalBalanceMinor: null, totalBalancePartial: false });
  assert.equal("finance" in noBalance, false, "disabled modules send nothing");
  assert.equal("previousPeriod" in noBalance, false);
});
