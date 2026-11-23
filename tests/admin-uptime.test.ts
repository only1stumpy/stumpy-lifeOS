import assert from "node:assert/strict";
import test from "node:test";
import { useDatabaseForTests } from "../src/db/client";
import * as schema from "../src/db/schema";
import { bucketStarts, fillSeries, loadCharts } from "../src/server/admin/charts";
import { computeUptime, loadUptime, uptimeLine, type HourBucket } from "../src/server/admin/uptime";
import { CRON_RUN_RETENTION_DAYS, purgeOldCronRuns } from "../src/server/retention";
import { createCommandDb, newTelegramId, ownerOf } from "./helpers/command-db";

const HOUR = 3600_000;
const NOW = new Date("2026-11-20T10:30:00Z");
const nowHour = Math.floor(NOW.getTime() / HOUR);
const at = (hoursAgo: number): HourBucket => ({ hour: nowHour - hoursAgo, runs: 2, failed: 0 });
/** Every completed hour of the last `n` hours has two runs. */
const steady = (n: number): HourBucket[] => Array.from({ length: n }, (_, i) => at(i + 1));

test("аптайм: без пропусков 100%, текущий час не оценивается", () => {
  const u = computeUptime(steady(24 * 7), NOW);
  assert.equal(u.day, 100);
  assert.equal(u.week, 100);
  assert.equal(u.missedHours7d, 0);
  assert.equal(u.hours.length, 168);
  assert.equal(computeUptime([], NOW).day, null, "истории нет: null, а не 0%");
});

test("аптайм: пропущенные часы снижают процент, часы до первого запуска — неизвестны", () => {
  const buckets = steady(48).filter((b) => ![5, 6, 7].includes(nowHour - b.hour)); // 3 часа без вызовов
  const u = computeUptime(buckets, NOW);
  assert.equal(u.missedHours7d, 3);
  assert.equal(u.day, Math.round((21 / 24) * 1000) / 10);
  // Мониторинг идёт 48 часов: неделя считается по известным 48, а не по 168.
  assert.equal(u.week, Math.round((45 / 48) * 1000) / 10);
  assert.equal(u.hours[0], "unknown");
  assert.equal(u.hours.at(-1), "up");
  assert.equal(u.hours.at(-6), "down");
});

test("аптайм: час, где все вызовы с ошибками, — degraded, но доступность не теряет", () => {
  const buckets = steady(24);
  buckets[2] = { ...buckets[2], failed: 2 };
  buckets[3] = { ...buckets[3], failed: 1 }; // один сбой из двух: час рабочий
  const u = computeUptime(buckets, NOW);
  assert.equal(u.degradedHours7d, 1);
  assert.equal(u.day, 100);
  assert.equal(u.hours.filter((s) => s === "degraded").length, 1);
});

test("аптайм: сутки считаются по известным часам, до старта — null", () => {
  const u = computeUptime(steady(30), NOW);
  assert.equal(u.days.length, 90);
  assert.equal(u.days[0].percent, null);
  assert.equal(u.days.at(-1)?.percent, 100);
  assert.match(uptimeLine(u), /Аптайм: 24 ч 100% · 7 дн 100%/);
  assert.match(uptimeLine(computeUptime([], NOW)), /нет данных/);
});

test("графики: сетка бакетов заполняется нулями, значения вне сетки не ломают ряд", () => {
  const starts = bucketStarts(NOW, 3, HOUR);
  assert.equal(starts.length, 3);
  assert.equal(starts[2], Math.floor(NOW.getTime() / HOUR) * HOUR);
  assert.deepEqual(fillSeries(starts, [{ at: starts[0], value: 2 }, { at: starts[0], value: 1 }, { at: starts[2], value: 4 }, { at: 1, value: 9 }]), [3, 0, 4]);
});

test("loadUptime и loadCharts: агрегаты из БД без идентификаторов, чистка истории cron через 90 дней", async (t) => {
  const { db } = await createCommandDb();
  t.after(() => useDatabaseForTests(undefined));
  const owner = await ownerOf(db, newTelegramId());
  const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR);
  await db.insert(schema.adminCronRuns).values([
    { startedAt: ago(1), finishedAt: ago(1), ok: true },
    { startedAt: ago(1.5), finishedAt: ago(1.5), ok: true },
    { startedAt: ago(3), finishedAt: ago(3), ok: false, errorClass: "x" },
    { startedAt: new Date(NOW.getTime() - (CRON_RUN_RETENTION_DAYS + 1) * 24 * HOUR), finishedAt: null },
  ]);
  await db.insert(schema.telegramUpdates).values([
    { ownerId: owner.id, telegramUpdateId: 1, payload: {}, status: "processed", receivedAt: ago(2) },
    { ownerId: owner.id, telegramUpdateId: 2, payload: {}, status: "failed", receivedAt: ago(2) },
  ]);

  const uptime = await loadUptime(NOW);
  assert.equal(uptime.missedHours7d, 1, "между вызовами 3 и 1 часа назад остался пустой час");
  assert.equal(uptime.degradedHours7d, 1);

  const charts = await loadCharts(NOW);
  assert.equal(charts.load.labels.length, 48);
  assert.equal(charts.load.series[0].values.reduce((a, b) => a + b, 0), 2);
  assert.equal(charts.errors.series[0].values.reduce((a, b) => a + b, 0), 1, "один failed update");
  assert.equal(charts.errors.series[2].values.reduce((a, b) => a + b, 0), 1, "один сбой cron");
  assert.doesNotMatch(JSON.stringify(charts), new RegExp(owner.id));

  await purgeOldCronRuns(NOW);
  assert.equal((await db.select().from(schema.adminCronRuns)).length, 3);
});
