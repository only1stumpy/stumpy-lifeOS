import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test, { mock, type TestContext } from "node:test";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { useDatabaseForTests } from "../src/db/client";
import { getBot, resetBotForTests } from "../src/server/telegram/client";
import { requireAdmin } from "../src/server/admin/config";
import { runMonitoredCron, CronFailure } from "../src/server/admin/monitoring";
import { computeStats } from "../src/server/admin/stats";
import { loadOverview } from "../src/server/admin/overview";
import { requeueFailedUpdates } from "../src/server/admin/actions";
import { finalizeExhaustedUpdate } from "../src/server/telegram/updates";
import { POST as adminBotWebhook } from "../src/app/api/admin-bot/route";
import { createCommandDb, newTelegramId, ownerOf, rejectsWith } from "./helpers/command-db";

// Tests share one process: every test that sets the admin environment restores it afterwards.
const ENV_KEYS = ["ADMIN_BOT_TOKEN", "ADMIN_TELEGRAM_IDS", "ADMIN_WEBHOOK_SECRET", "TELEGRAM_BOT_TOKEN"] as const;

const ADMIN_TOKEN = "111111:admin-bot-token";
const USER_TOKEN = "222222:user-bot-token";
const ADMIN_ID = 424242;

function signed(token: string, userId: number, authDate = Math.floor(Date.now() / 1000)): string {
  const params = new URLSearchParams({ auth_date: String(authDate), user: JSON.stringify({ id: userId, first_name: "A" }) });
  const check = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("\n");
  const hash = createHmac("sha256", createHmac("sha256", "WebAppData").update(token).digest()).update(check).digest("hex");
  params.set("hash", hash);
  return params.toString();
}
const req = (initData?: string) => new Request("https://x.test/api/admin/overview", { headers: initData ? { authorization: `tma ${initData}` } : {} });

/** Puts shared state (test database, bot singleton, mocks) back after a test. */
function isolate(t: TestContext) {
  t.after(() => {
    mock.restoreAll();
    resetBotForTests();
    useDatabaseForTests(undefined);
  });
}

function configureAdmin(t: TestContext) {
  isolate(t);
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  t.after(() => {
    mock.restoreAll();
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });
  process.env.ADMIN_BOT_TOKEN = ADMIN_TOKEN;
  process.env.ADMIN_TELEGRAM_IDS = `${ADMIN_ID}, 999`;
  process.env.ADMIN_WEBHOOK_SECRET = "w".repeat(32);
  process.env.TELEGRAM_BOT_TOKEN = USER_TOKEN;
}

/** Records Bot API calls instead of sending them. */
function captureTelegram() {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  mock.method(globalThis, "fetch", async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
    return Response.json({ ok: true, result: { message_id: 1 } });
  });
  return calls;
}

test("админ-API: подпись админ-бота и ID из списка — доступ, всё остальное — 403", async (t) => {
  isolate(t);
  const { db } = await createCommandDb();
  void db;
  configureAdmin(t);
  assert.equal((await requireAdmin(req(signed(ADMIN_TOKEN, ADMIN_ID)))).id, String(ADMIN_ID));
  await rejectsWith(requireAdmin(req(signed(USER_TOKEN, ADMIN_ID))), 403); // подпись токеном основного бота
  await rejectsWith(requireAdmin(req(signed(ADMIN_TOKEN, 777))), 403); // чужой ID
  await rejectsWith(requireAdmin(req(signed(ADMIN_TOKEN, ADMIN_ID, Math.floor(Date.now() / 1000) - 7200))), 403); // срок вышел
  await rejectsWith(requireAdmin(req()), 401);
  delete process.env.ADMIN_BOT_TOKEN;
  await rejectsWith(requireAdmin(req(signed(ADMIN_TOKEN, ADMIN_ID))), 503);
});

test("статистика: нет идентификаторов, малые группы скрыты", async (t) => {
  isolate(t);
  const { db } = await createCommandDb();
  const ids: string[] = [];
  for (let i = 0; i < 8; i += 1) {
    const id = newTelegramId();
    ids.push(id);
    await ownerOf(db, id);
  }
  // Три пользователя с другой валютой и поясом: меньше порога.
  for (const id of ids.slice(0, 3)) await db.update(schema.ownerSettings).set({ baseCurrency: "PRB", timezone: "Asia/Tokyo" }).where(eq(schema.ownerSettings.telegramUserId, id));
  const stats = await computeStats();
  const json = JSON.stringify(stats);
  for (const id of ids) assert.ok(!json.includes(id), "в ответе нет Telegram ID");
  assert.ok(!/telegram|username|owner_id|ownerId/i.test(json), "в ответе нет полей идентификации");
  assert.equal(stats.audience.total, 8);
  const prb = stats.slices.currencies.find((item) => item.value === "PRB");
  assert.deepEqual(prb?.users, { count: "<5", share: null });
  assert.deepEqual(stats.slices.timezones.find((item) => item.value === "Asia/Tokyo")?.users, { count: "<5", share: null });
  assert.equal(stats.slices.timezones.find((item) => item.value === "Europe/Chisinau")?.users.count, 5);
  assert.equal(stats.audience.dau, 0);
});

test("статистика: отметка активности считается в DAU/WAU/MAU", async (t) => {
  isolate(t);
  const { db } = await createCommandDb();
  for (let i = 0; i < 6; i += 1) {
    await ownerOf(db, newTelegramId());
  }
  await db.update(schema.ownerSettings).set({ lastActiveDate: new Date().toISOString().slice(0, 10) });
  const stats = await computeStats();
  assert.equal(stats.audience.dau, 6);
  assert.equal(stats.audience.wau, 6);
});

test("cron: ошибка прогона отправляет алерт админам и пробрасывается как сбой", async (t) => {
  isolate(t);
  const { db } = await createCommandDb();
  configureAdmin(t);
  const calls = captureTelegram();
  try {
    await assert.rejects(runMonitoredCron(async () => { throw new Error("secret payload must not leak"); }), (error: unknown) => error instanceof CronFailure);
    const alerts = calls.filter((call) => call.url.includes(`/bot${ADMIN_TOKEN}/sendMessage`));
    assert.equal(alerts.length, 2, "оба админа получили алерт");
    assert.ok(alerts.every((call) => String(call.body.text).includes("cron завершился с ошибкой") && !String(call.body.text).includes("secret payload")));
    const [run] = await db.select().from(schema.adminCronRuns);
    assert.equal(run.ok, false);
    // Повторный сбой в окне подавления не дублирует алерт.
    await assert.rejects(runMonitoredCron(async () => { throw new Error("again"); }));
    assert.equal(calls.filter((call) => call.url.includes("/sendMessage")).length, 2);
  } finally {
    mock.restoreAll();
  }
});

test("cron: пользователи с ошибками дают алерт, заблокировавшие бота — нет", async (t) => {
  await createCommandDb();
  configureAdmin(t);
  const calls = captureTelegram();
  try {
    const clean = { sent: 1, failed: 0, skippedOwners: 0, undeliverable: 3, errorClasses: {} };
    await runMonitoredCron(async () => clean);
    assert.equal(calls.length, 0);
    await runMonitoredCron(async () => ({ ...clean, failed: 2, errorClasses: { "AppError:503": 2 } }));
    assert.ok(calls.some((call) => String(call.body.text).includes("AppError:503")));
  } finally {
    mock.restoreAll();
  }
});

test("update, исчерпавший попытки: пользователь и админ уведомлены ровно один раз", async (t) => {
  isolate(t);
  const { db } = await createCommandDb();
  configureAdmin(t);
  const owner = await ownerOf(db, newTelegramId());
  const payload = { update_id: 1, message: { chat: { id: 5551, type: "private" }, text: "съел яблоко" } };
  const [row] = await db.insert(schema.telegramUpdates).values({ ownerId: owner.id, telegramUpdateId: 1, payload, status: "failed", attemptCount: 3, lastError: "handler_failed" }).returning();
  const calls = captureTelegram();
  // grammY talks through node-fetch, so the user-facing bot is stubbed at its API object.
  const userMessages: { chatId: unknown; text: unknown }[] = [];
  mock.method(getBot().api, "sendMessage", async (chatId: unknown, text: unknown) => { userMessages.push({ chatId, text }); return {} as never; });
  try {
    await finalizeExhaustedUpdate(row.id, payload, "handler_failed");
    await finalizeExhaustedUpdate(row.id, payload, "handler_failed");
    assert.equal(userMessages.length, 1);
    assert.equal(userMessages[0].chatId, 5551);
    assert.match(String(userMessages[0].text), /Повтори/);
    assert.ok(calls.some((call) => call.url.includes(ADMIN_TOKEN) && String(call.body.text).includes("исчерпал попытки")));
    assert.ok(calls.filter((call) => call.url.includes(ADMIN_TOKEN)).every((call) => !JSON.stringify(call.body).includes("яблоко")), "текст сообщения пользователя не уходит админам");
  } finally {
    mock.restoreAll();
  }
});

test("админ-бот: чужому молчание, админу ответ с кнопкой Mini App; неверный секрет — 401", async (t) => {
  await createCommandDb();
  configureAdmin(t);
  const calls = captureTelegram();
  const post = (fromId: number, secret = "w".repeat(32)) => adminBotWebhook(new Request("https://lifeos.test/api/admin-bot", {
    method: "POST",
    headers: { "x-telegram-bot-api-secret-token": secret },
    body: JSON.stringify({ update_id: 1, message: { from: { id: fromId }, chat: { id: fromId, type: "private" }, text: "/start" } }),
  }));
  try {
    assert.equal((await post(777)).status, 200);
    assert.equal(calls.length, 0, "постороннему ничего не отправляется");
    assert.equal((await post(ADMIN_ID)).status, 200);
    assert.equal(calls.length, 1);
    assert.match(JSON.stringify(calls[0].body), /https:\/\/lifeos\.test\/admin/);
    assert.equal((await post(ADMIN_ID, "bad")).status, 401);
  } finally {
    mock.restoreAll();
  }
});

test("обзор и повтор failed: без идентификаторов, повтор возвращает только свежие update", async (t) => {
  isolate(t);
  const { db } = await createCommandDb();
  const owner = await ownerOf(db, newTelegramId());
  await db.insert(schema.telegramUpdates).values([
    { ownerId: owner.id, telegramUpdateId: 11, payload: { update_id: 11, message: { text: "x" } }, status: "failed", attemptCount: 3, lastError: "handler_failed" },
    { ownerId: owner.id, telegramUpdateId: 12, payload: {}, status: "failed", attemptCount: 3, lastError: "stale" },
  ]);
  const overview = await loadOverview();
  assert.equal(overview.queue.exhausted, 2);
  assert.ok(!JSON.stringify(overview).includes(owner.telegramUserId));
  const ids = await requeueFailedUpdates();
  assert.equal(ids.length, 1);
  const [row] = await db.select().from(schema.telegramUpdates).where(eq(schema.telegramUpdates.telegramUpdateId, 11));
  assert.equal(row.status, "received");
  assert.equal(row.attemptCount, 0);
});
