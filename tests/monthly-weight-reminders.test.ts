import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { dateKey } from "../src/domain/math";
import { isLastDayOfMonth, notificationSettingsSchema, USAGE_MODES } from "../src/domain/notifications";
import { createCommandDb, newTelegramId, ownerOf, releaseCommandDb, run, snapshotOf } from "./helpers/command-db";
import { getBot, resetBotForTests } from "../src/server/telegram/client";

test("последний день месяца: 28–31, високосный февраль, границы года", () => {
  assert.equal(isLastDayOfMonth("2026-02-28"), true);
  assert.equal(isLastDayOfMonth("2026-02-27"), false);
  assert.equal(isLastDayOfMonth("2028-02-28"), false, "2028 високосный");
  assert.equal(isLastDayOfMonth("2028-02-29"), true);
  assert.equal(isLastDayOfMonth("2026-04-30"), true);
  assert.equal(isLastDayOfMonth("2026-04-29"), false);
  assert.equal(isLastDayOfMonth("2026-12-31"), true);
  assert.equal(isLastDayOfMonth("2026-01-31"), true);
});

test("последний день месяца считается по календарю часового пояса, а не UTC", () => {
  const instant = new Date("2026-11-30T22:30:00Z");
  assert.equal(isLastDayOfMonth(dateKey(instant, "UTC")), true);
  assert.equal(isLastDayOfMonth(dateKey(instant, "Pacific/Auckland")), false, "в Окленде уже 1 декабря");
  assert.equal(isLastDayOfMonth(dateKey(instant, "America/Los_Angeles")), true);
  // Month end in UTC but already the next month in UTC+3 (Moscow): 31 Oct 21:30Z is 1 Nov 00:30 local.
  assert.equal(isLastDayOfMonth(dateKey(new Date("2026-10-31T21:30:00Z"), "Europe/Moscow")), false);
});

test("новые настройки по умолчанию выключены, в том числе в пресетах знакомства", () => {
  const parsed = notificationSettingsSchema.parse({ dailySummary: true, weeklySummary: true, weightReminder: true, summaryTime: null });
  assert.equal(parsed.monthlySummary, false);
  assert.equal(parsed.dailyWeightReminder, false);
  for (const preset of Object.values(USAGE_MODES)) {
    assert.equal(preset.monthlySummary, false);
    assert.equal(preset.dailyWeightReminder, false);
  }
});

test("новый пользователь: месячная сводка и ежедневное напоминание выключены; сохранение переключателей работает", async (t) => {
  t.after(releaseCommandDb);
  const { db } = await createCommandDb();
  const tg = newTelegramId();
  const owner = await ownerOf(db, tg);
  assert.equal(owner.monthlySummaryEnabled, false);
  assert.equal(owner.dailyWeightReminderEnabled, false);
  const settings = { dailySummary: false, weeklySummary: false, weightReminder: true, monthlySummary: true, dailyWeightReminder: true, summaryTime: "09:00" };
  await run(tg, { type: "notifications.save", settings });
  const snapshot = await snapshotOf(tg);
  assert.equal(snapshot.settings.notifications.monthlySummary, true);
  assert.equal(snapshot.settings.notifications.dailyWeightReminder, true);
});

async function cronWithMockedTelegram(t: import("node:test").TestContext) {
  process.env.TELEGRAM_BOT_TOKEN = "123456:TEST";
  resetBotForTests();
  const sent: string[] = [];
  mock.method(getBot().api, "sendMessage", async (_chat: unknown, text: unknown) => { sent.push(String(text)); return {} as never; });
  t.after(() => { mock.restoreAll(); resetBotForTests(); releaseCommandDb(); });
  const { runScheduledTasks } = await import("../src/server/cron");
  return { sent, runScheduledTasks };
}

test("cron: месячная сводка уходит в последний день месяца в своё время и один раз", async (t) => {
  const { db } = await createCommandDb();
  const { sent, runScheduledTasks } = await cronWithMockedTelegram(t);
  const owner = await ownerOf(db, newTelegramId());
  await db.update(schema.ownerSettings).set({ timezone: "UTC", summaryTime: "10:00", monthlySummaryEnabled: true, lastSeenVersion: "0.0.0" }).where(eq(schema.ownerSettings.id, owner.id));

  await runScheduledTasks({ now: new Date("2026-11-29T10:05:00Z") });
  assert.equal(sent.filter((text) => text.includes("Вот как прошёл месяц")).length, 0, "29 ноября — не последний день");
  await runScheduledTasks({ now: new Date("2026-11-30T09:50:00Z") });
  assert.equal(sent.filter((text) => text.includes("Вот как прошёл месяц")).length, 0, "до времени сводки");
  await runScheduledTasks({ now: new Date("2026-11-30T10:05:00Z") });
  await runScheduledTasks({ now: new Date("2026-11-30T10:20:00Z") });
  const monthly = sent.filter((text) => text.includes("Вот как прошёл месяц"));
  assert.equal(monthly.length, 1, "дедупликация через notification_deliveries");
  assert.match(monthly[0], /2026-11-01 — 2026-11-30/);
  const keys = (await db.select().from(schema.notificationDeliveries)).map((row) => row.key);
  assert.ok(keys.includes("monthly:2026-11-30"));
});

test("cron: выключенная месячная сводка не отправляется", async (t) => {
  const { db } = await createCommandDb();
  const { sent, runScheduledTasks } = await cronWithMockedTelegram(t);
  const owner = await ownerOf(db, newTelegramId());
  await db.update(schema.ownerSettings).set({ timezone: "UTC", summaryTime: "10:00", lastSeenVersion: "0.0.0" }).where(eq(schema.ownerSettings.id, owner.id));
  await runScheduledTasks({ now: new Date("2026-11-30T10:05:00Z") });
  assert.equal(sent.length, 0);
});

test("cron: ежедневное напоминание взвеситься и четверговое дают одно сообщение в день", async (t) => {
  const { db } = await createCommandDb();
  const { sent, runScheduledTasks } = await cronWithMockedTelegram(t);
  const owner = await ownerOf(db, newTelegramId());
  await db.update(schema.ownerSettings).set({ timezone: "UTC", summaryTime: "10:00", weightReminderEnabled: true, dailyWeightReminderEnabled: true, lastSeenVersion: "0.0.0" }).where(eq(schema.ownerSettings.id, owner.id));
  // 2026-11-19 is a Thursday: both reminders are due, there are no weigh-ins at all.
  await runScheduledTasks({ now: new Date("2026-11-19T10:05:00Z") });
  await runScheduledTasks({ now: new Date("2026-11-19T10:20:00Z") });
  assert.equal(sent.length, 1);
  // Friday: only the daily one.
  await runScheduledTasks({ now: new Date("2026-11-20T10:05:00Z") });
  assert.equal(sent.length, 2);
  assert.match(sent[1], /Пора взвеситься/);
});

test("cron: ежедневное напоминание молчит, если вес за день уже записан", async (t) => {
  const { db } = await createCommandDb();
  const { sent, runScheduledTasks } = await cronWithMockedTelegram(t);
  const owner = await ownerOf(db, newTelegramId());
  await db.update(schema.ownerSettings).set({ timezone: "UTC", summaryTime: "10:00", dailyWeightReminderEnabled: true, lastSeenVersion: "0.0.0" }).where(eq(schema.ownerSettings.id, owner.id));
  await db.insert(schema.weightEntries).values({ ownerId: owner.id, weightKg: "72.4", occurredAt: new Date("2026-11-20T06:00:00Z") });
  await runScheduledTasks({ now: new Date("2026-11-20T10:05:00Z") });
  assert.equal(sent.length, 0);
});
