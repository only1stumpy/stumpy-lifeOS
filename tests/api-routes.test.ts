import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { createCommandDb, newTelegramId, ownerOf } from "./helpers/command-db";

// Route contracts: who gets in, what is rejected, and what must not leak. The routes run against the
// real migrations on PGlite; Telegram itself is never called.
const BOT_TOKEN = "123456:route-test-token";
const WEBHOOK_SECRET = "w".repeat(40);
const CRON_SECRET = "c".repeat(40);
Object.assign(process.env, { TELEGRAM_BOT_TOKEN: BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET, CRON_SECRET });
delete process.env.TELEGRAM_OWNER_ID;

function initData(userId: number, authDate = Math.floor(Date.now() / 1000)) {
  const fields: [string, string][] = [["auth_date", String(authDate)], ["query_id", "AAE-route"], ["user", JSON.stringify({ id: userId, first_name: "T" })]];
  const check = [...fields].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("\n");
  const key = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const params = new URLSearchParams(fields);
  params.append("hash", createHmac("sha256", key).update(check).digest("hex"));
  return params.toString();
}
const api = (path: string, init: RequestInit = {}) => new Request(`http://localhost${path}`, init);
const body = async (response: Response) => (await response.json()) as Record<string, unknown>;

const protectedRoutes: [string, string, string][] = [
  ["snapshot", "/api/snapshot", "GET"],
  ["commands", "/api/commands", "POST"],
  ["export", "/api/export", "GET"],
  ["ai-providers", "/api/ai-providers", "GET"],
  ["ai-quotas", "/api/ai-quotas", "GET"],
];

for (const [name, path, method] of protectedRoutes) {
  test(`/api/${name}: без подписи Telegram — 401, с испорченной подписью — 401`, async () => {
    const route = await import(`../src/app/api/${name}/route`);
    const handler = route[method];
    const none = await handler(api(path, { method }));
    assert.equal(none.status, 401);
    const forged = await handler(api(path, { method, headers: { authorization: `tma ${initData(42)}x` } }));
    assert.equal(forged.status, 401);
    const stale = await handler(api(path, { method, headers: { authorization: `tma ${initData(42, 1_000_000_000)}` } }));
    assert.equal(stale.status, 401);
  });
}

test("/api/snapshot: подписанный пользователь получает только свои данные", async () => {
  const { db } = await createCommandDb();
  const a = newTelegramId();
  const b = newTelegramId();
  await ownerOf(db, a);
  await ownerOf(db, b);
  const { GET } = await import("../src/app/api/snapshot/route");
  const response = await GET(api("/api/snapshot", { headers: { authorization: `tma ${initData(Number(a))}` } }));
  assert.equal(response.status, 200);
  const snapshot = await body(response);
  assert.ok(snapshot.localDate, "снимок содержит дату");
  assert.ok(!JSON.stringify(snapshot).includes(b), "в снимке нет чужого Telegram ID");
});

test("/api/health: без секретов, с версией", async () => {
  const { GET } = await import("../src/app/api/health/route");
  const response = await GET();
  assert.equal(response.status, 200);
  const payload = await body(response);
  assert.equal(payload.status, "ok");
  assert.equal(typeof payload.version, "string");
  assert.deepEqual(Object.keys(payload).sort(), ["status", "version"]);
});

test("webhook: неверный секрет — 401, пустое и битое тело — 4xx, чужой чат подтверждается без записи", async () => {
  const { db } = await createCommandDb();
  const { POST } = await import("../src/app/api/telegram/route");
  const post = (raw: string, secret = WEBHOOK_SECRET) =>
    POST(api("/api/telegram", { method: "POST", headers: { "x-telegram-bot-api-secret-token": secret }, body: raw }));

  assert.equal((await post("{}", "wrong")).status, 401);
  assert.equal((await post("")).status, 413);
  assert.equal((await post("not json")).status, 400);
  assert.equal((await post(JSON.stringify({ update_id: -1 }))).status, 400);

  const group = { update_id: 9001, message: { chat: { type: "group" }, from: { id: 5 }, text: "hi" } };
  const ack = await post(JSON.stringify(group));
  assert.equal(ack.status, 200);
  assert.equal((await db.select().from(schema.telegramUpdates).where(eq(schema.telegramUpdates.telegramUpdateId, 9001))).length, 0);
});

test("webhook: без настроенного секрета — 503", async () => {
  const saved = process.env.TELEGRAM_WEBHOOK_SECRET;
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  try {
    const { POST } = await import("../src/app/api/telegram/route");
    assert.equal((await POST(api("/api/telegram", { method: "POST", body: "{}" }))).status, 503);
  } finally {
    process.env.TELEGRAM_WEBHOOK_SECRET = saved;
  }
});

test("cron: без секрета — 401, без настройки — 503, пустая база — ok", async () => {
  await createCommandDb();
  const { GET } = await import("../src/app/api/cron/route");
  assert.equal((await GET(api("/api/cron"))).status, 401);
  assert.equal((await GET(api("/api/cron", { headers: { authorization: "Bearer wrong" } }))).status, 401);
  const ok = await GET(api("/api/cron", { headers: { authorization: `Bearer ${CRON_SECRET}` } }));
  assert.equal(ok.status, 200);
  assert.deepEqual(await body(ok), { ok: true, sent: 0, failed: 0 });

  delete process.env.CRON_SECRET;
  try {
    assert.equal((await GET(api("/api/cron", { headers: { authorization: `Bearer ${CRON_SECRET}` } }))).status, 503);
  } finally {
    process.env.CRON_SECRET = CRON_SECRET;
  }
});

test("cron: сбой одного владельца не останавливает остальных и попадает в счётчик failed", async () => {
  const { db } = await createCommandDb();
  const broken = await ownerOf(db, newTelegramId());
  await ownerOf(db, newTelegramId());
  await db.update(schema.ownerSettings).set({ timezone: "Not/AZone" }).where(eq(schema.ownerSettings.id, broken.id));
  const { GET } = await import("../src/app/api/cron/route");
  const response = await GET(api("/api/cron", { headers: { authorization: `Bearer ${CRON_SECRET}` } }));
  const payload = await body(response);
  assert.equal(response.status, 500, "прогон со сбоем не отвечает 200");
  assert.equal(payload.failed, 1);
  assert.equal(payload.ok, false);
});

test("webhook: личное сообщение сохраняется до ответа, повтор того же update_id не дублируется", async () => {
  const { db } = await createCommandDb();
  const { POST } = await import("../src/app/api/telegram/route");
  const userId = Number(newTelegramId());
  const update = { update_id: 424242, message: { message_id: 1, date: 1, chat: { id: userId, type: "private" }, from: { id: userId, is_bot: false, first_name: "T" }, text: "/help" } };
  const send = () => POST(api("/api/telegram", { method: "POST", headers: { "x-telegram-bot-api-secret-token": WEBHOOK_SECRET }, body: JSON.stringify(update) }));
  // `after()` needs a live request scope; outside one it throws, which the route reports as 503 after the row is stored.
  const first = await send();
  assert.equal(first.status, 503, "вне запроса Next after() недоступен: строка сохранена, но фоновая обработка не стартовала");
  const rows = () => db.select().from(schema.telegramUpdates).where(eq(schema.telegramUpdates.telegramUpdateId, 424242));
  assert.equal((await rows()).length, 1, "update сохранён до ответа");
  await send();
  assert.equal((await rows()).length, 1, "повтор не создаёт вторую запись");
});

test("ready: без секрета — 401, без журнала миграций — 503, с последней миграцией — 200, с отставанием — 503", async () => {
  const { client } = await createCommandDb();
  const { GET } = await import("../src/app/api/ready/route");
  const { default: journal } = await import("../drizzle/meta/_journal.json", { with: { type: "json" } });
  const last = journal.entries.reduce((a, b) => (b.when > a.when ? b : a));
  const auth = { headers: { authorization: `Bearer ${CRON_SECRET}` } };
  assert.equal((await GET(api("/api/ready"))).status, 401);
  assert.equal((await GET(api("/api/ready", { headers: { authorization: "Bearer wrong" } }))).status, 401);
  assert.equal((await GET(api("/api/ready", auth))).status, 503);
  await client.exec('CREATE SCHEMA drizzle; CREATE TABLE drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)');
  await client.exec(`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('x', ${journal.entries[0].when})`);
  const pending = await GET(api("/api/ready", auth));
  assert.equal(pending.status, 503);
  assert.equal((await body(pending)).status, "migrations_pending");
  await client.exec(`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('y', ${last.when})`);
  const ready = await GET(api("/api/ready", auth));
  assert.equal(ready.status, 200);
  assert.equal((await body(ready)).migration, last.tag);
});
