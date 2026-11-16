import assert from "node:assert/strict";
import { after, before, beforeEach, describe, mock, test } from "node:test";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { MAX_UPDATE_ATTEMPTS, processStoredTelegramUpdate, retryFailedTelegramUpdates } from "../src/server/telegram/updates";
import { createCommandDb, releaseCommandDb, newTelegramId, ownerOf, type CommandDb } from "./helpers/command-db";
import { createBotHarness, foodAndExpenseReply, type BotCall } from "./helpers/bot-harness";

// Persisted updates: what survives a crash after partial effects, how many attempts an update gets,
// and what happens to updates that hung or went stale.
// Hooks live inside a suite: with --test-isolation=none top-level hooks would run once for the whole process.
describe('повторы persisted update', () => {
let db: CommandDb;
let harness: Awaited<ReturnType<typeof createBotHarness>>;

before(async () => {
  ({ db } = await createCommandDb());
  harness = await createBotHarness();
  mock.method(console, "error", () => undefined); // failed handlers are logged by design; keep test output readable
});
beforeEach(async () => {
  harness.failBotApiWhen(undefined);
  await db.delete(schema.telegramUpdates); // each test sees only its own rows
});
after(async () => {
  mock.restoreAll();
  await harness.close();
  releaseCommandDb();
});

const EXHAUSTED = /^Не получилось обработать сообщение/;
const isDraftOrErrorReply = (call: BotCall) => call.method === "sendMessage" && !String(call.payload.text).startsWith("Разбираю") && !EXHAUSTED.test(String(call.payload.text));

async function storeUpdate(tg: string, options: { text?: string; receivedAt?: Date; status?: string; attemptCount?: number; processingStartedAt?: Date } = {}) {
  const owner = await ownerOf(db, tg);
  const update = harness.messageUpdate(tg, options.text ?? "съел удон за 85 рублей");
  const [row] = await db.insert(schema.telegramUpdates).values({
    ownerId: owner.id,
    telegramUpdateId: update.update_id,
    payload: update as unknown as Record<string, unknown>,
    ...(options.receivedAt ? { receivedAt: options.receivedAt } : {}),
    ...(options.status ? { status: options.status } : {}),
    ...(options.attemptCount !== undefined ? { attemptCount: options.attemptCount } : {}),
    ...(options.processingStartedAt ? { processingStartedAt: options.processingStartedAt } : {}),
  }).returning();
  return { owner, row: row! };
}
const reload = async (id: string) => (await db.select().from(schema.telegramUpdates).where(eq(schema.telegramUpdates.id, id)))[0]!;
const draftCount = async (ownerId: string) => (await db.select().from(schema.captureDrafts).where(eq(schema.captureDrafts.ownerId, ownerId))).length;

test("падение после создания черновиков: повтор не вызывает ИИ второй раз и не дублирует черновики", async () => {
  const tg = newTelegramId();
  await harness.onboard(tg);
  harness.answerAiWith(foodAndExpenseReply());
  const { owner, row } = await storeUpdate(tg);

  harness.failBotApiWhen(isDraftOrErrorReply); // drafts are saved, then Telegram fails when they are sent
  await processStoredTelegramUpdate(row.id);
  const failed = await reload(row.id);
  assert.equal(failed.status, "failed");
  assert.equal(failed.attemptCount, 1);
  assert.equal(failed.lastError, "handler_failed");
  assert.equal(await draftCount(owner.id), 2, "частичный эффект: черновики уже сохранены");
  assert.equal(harness.aiAnalysisCalls().length, 1);

  harness.failBotApiWhen(undefined);
  harness.clearCalls();
  await processStoredTelegramUpdate(row.id);
  const done = await reload(row.id);
  assert.equal(done.status, "processed");
  assert.equal(done.attemptCount, 2);
  assert.deepEqual(done.payload, {}, "после обработки текст сообщения не хранится");
  assert.equal(await draftCount(owner.id), 2, "повтор не создал вторую пару черновиков");
  assert.equal(harness.aiAnalysisCalls().length, 1, "ИИ не вызывался повторно");
  assert.equal(harness.sentTexts().filter((text) => text.startsWith("Проверь, пожалуйста")).length, 2, "повтор отправил оба черновика");
});

test("обработанный update повторно не выполняется", async () => {
  const tg = newTelegramId();
  await harness.onboard(tg);
  harness.answerAiWith(foodAndExpenseReply());
  const { row } = await storeUpdate(tg);
  await processStoredTelegramUpdate(row.id);
  harness.clearCalls();
  await processStoredTelegramUpdate(row.id);
  assert.equal(harness.callsTo("sendMessage").length, 0);
  assert.equal((await reload(row.id)).attemptCount, 1);
});

test("лимит попыток: после исчерпания update больше не выполняется, пользователь получает одно уведомление", async () => {
  const tg = newTelegramId();
  await harness.onboard(tg);
  harness.answerAiWith(foodAndExpenseReply());
  const { row } = await storeUpdate(tg);

  harness.failBotApiWhen(isDraftOrErrorReply);
  harness.clearCalls();
  for (let attempt = 0; attempt < MAX_UPDATE_ATTEMPTS + 2; attempt += 1) await processStoredTelegramUpdate(row.id);

  const exhausted = await reload(row.id);
  assert.equal(exhausted.status, "failed");
  assert.equal(exhausted.attemptCount, MAX_UPDATE_ATTEMPTS, "попыток не больше лимита");
  assert.equal(harness.sentTexts().filter((text) => EXHAUSTED.test(text)).length, 1, "уведомление об исчерпании — ровно одно");
  assert.equal(await retryFailedTelegramUpdates({ maxUpdates: 10 }), 0, "исчерпанный update cron не берёт");
  assert.equal(harness.sentTexts().filter((text) => EXHAUSTED.test(text)).length, 1);
});

test("зависший в processing update сбрасывается и обрабатывается, свежий — не трогается", async () => {
  const tgStuck = newTelegramId();
  const tgFresh = newTelegramId();
  await harness.onboard(tgStuck);
  await harness.onboard(tgFresh);
  harness.answerAiWith(foodAndExpenseReply());
  const stuck = await storeUpdate(tgStuck, { status: "processing", attemptCount: 1, processingStartedAt: new Date(Date.now() - 5 * 60_000) });
  const fresh = await storeUpdate(tgFresh, { status: "processing", attemptCount: 1, processingStartedAt: new Date(Date.now() - 10_000) });

  const processed = await retryFailedTelegramUpdates({ maxUpdates: 10 });
  assert.equal(processed, 1);
  const stuckAfter = await reload(stuck.row.id);
  assert.equal(stuckAfter.status, "processed");
  assert.equal(stuckAfter.attemptCount, 2);
  assert.equal(await draftCount(stuck.owner.id), 2);
  const freshAfter = await reload(fresh.row.id);
  assert.equal(freshAfter.status, "processing", "идущая обработка не перехватывается");
  assert.equal(freshAfter.attemptCount, 1);
  assert.equal(await draftCount(fresh.owner.id), 0);
});

test("зависший update на последней попытке не обрабатывается, а закрывается уведомлением", async () => {
  const tg = newTelegramId();
  await harness.onboard(tg);
  harness.answerAiWith(foodAndExpenseReply());
  const { owner, row } = await storeUpdate(tg, { status: "processing", attemptCount: MAX_UPDATE_ATTEMPTS, processingStartedAt: new Date(Date.now() - 5 * 60_000) });
  harness.clearCalls();
  assert.equal(await retryFailedTelegramUpdates({ maxUpdates: 10 }), 0);
  const after = await reload(row.id);
  assert.equal(after.status, "failed");
  assert.equal(await draftCount(owner.id), 0);
  assert.equal(harness.sentTexts().filter((text) => EXHAUSTED.test(text)).length, 1);
});

test("update старше срока не разбирается задним числом: пользователю предлагают отправить заново", async () => {
  const tg = newTelegramId();
  await harness.onboard(tg);
  harness.answerAiWith(foodAndExpenseReply());
  const { owner, row } = await storeUpdate(tg, { status: "failed", attemptCount: 1, receivedAt: new Date(Date.now() - 7 * 3600_000) });
  const aiBefore = harness.aiAnalysisCalls().length;
  harness.clearCalls();

  assert.equal(await retryFailedTelegramUpdates({ maxUpdates: 10 }), 0);
  const after = await reload(row.id);
  assert.equal(after.status, "failed");
  assert.equal(after.lastError, "stale");
  assert.equal(after.attemptCount, MAX_UPDATE_ATTEMPTS);
  assert.equal(await draftCount(owner.id), 0);
  assert.equal(harness.aiAnalysisCalls().length, aiBefore);
  assert.ok(harness.sentTexts().some((text) => /Отправь его ещё раз/.test(text)));
});

test("cron не начинает повтор, если до конца функции осталось меньше запаса времени", async () => {
  const tg = newTelegramId();
  await harness.onboard(tg);
  const { row } = await storeUpdate(tg, { status: "failed", attemptCount: 1 });
  assert.equal(await retryFailedTelegramUpdates({ maxUpdates: 10, deadlineAt: Date.now() + 10_000 }), 0);
  assert.equal((await reload(row.id)).status, "failed");
  assert.equal((await reload(row.id)).attemptCount, 1);
});
});
