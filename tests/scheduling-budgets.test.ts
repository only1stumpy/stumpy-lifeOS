import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { inSummaryWindow, minuteOfDay } from "../src/domain/notifications";
import { AIAnalysisError } from "../src/server/ai/types";
import { ProviderFailure, resetQuotaCooldowns, runProviderChain, type ProviderConfig } from "../src/server/ai/analyze";
import { createCommandDb, newTelegramId, ownerOf } from "./helpers/command-db";

const candidate = (accountId: string, model = "m"): ProviderConfig => ({ provider: "openai-compatible", model, apiKey: "k", accountId });
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test("цепочка ИИ: медленные кандидаты укладываются в общий бюджет, остаток уходит в таймаут попытки", async () => {
  resetQuotaCooldowns();
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  try {
    const timeouts: number[] = [];
    // Every provider hangs until its own timeout fires, like a slow upstream.
    const slow = (_: ProviderConfig, timeoutMs: number) => {
      timeouts.push(timeoutMs);
      return new Promise<string>((_resolve, reject) => setTimeout(() => reject(new ProviderFailure("unavailable")), timeoutMs));
    };
    const outcome = runProviderChain(["a", "b", "c", "d", "e"].map((id) => candidate(id)), undefined, "food", slow)
      .then(() => null, (error: unknown) => error);
    for (let i = 0; i < 8; i += 1) {
      await flush();
      mock.timers.tick(18_000);
    }
    const error = await outcome;
    assert.ok(error instanceof AIAnalysisError);
    assert.equal(error.code, "time_budget");
    assert.match(error.message, /слишком медленно/);
    assert.deepEqual(timeouts, [18_000, 18_000, 6_000], "третья попытка получает только остаток бюджета (42 с)");
    assert.equal(timeouts.reduce((sum, value) => sum + value, 0), 42_000, "сумма таймаутов равна бюджету");
  } finally {
    mock.timers.reset();
  }
});

test("цепочка ИИ: не больше заданного числа кандидатов, при быстрых сбоях честная ошибка провайдеров", async () => {
  resetQuotaCooldowns();
  let calls = 0;
  const failing = async () => {
    calls += 1;
    throw new ProviderFailure("unavailable");
  };
  const many = Array.from({ length: 30 }, (_, index) => candidate(`acc-${index}`));
  await assert.rejects(() => runProviderChain(many, undefined, "food", failing), (error: unknown) => error instanceof AIAnalysisError && error.code === "provider_unavailable");
  assert.equal(calls, 6);
});

test("цепочка ИИ: аккаунт с недавним 429 пропускается, но если других нет — всё же пробуется", async () => {
  resetQuotaCooldowns();
  const seen: string[] = [];
  const attempt = (config: ProviderConfig) => {
    seen.push(config.accountId ?? "");
    if (config.accountId === "limited") throw new ProviderFailure("quota_exceeded");
    return Promise.resolve("ok");
  };
  const first = await runProviderChain([candidate("limited"), candidate("fine")], undefined, "food", attempt);
  assert.equal(first.value, "ok");
  assert.deepEqual(seen, ["limited", "fine"]);

  seen.length = 0;
  await runProviderChain([candidate("limited", "m2"), candidate("fine")], undefined, "food", attempt);
  assert.deepEqual(seen, ["fine"], "второй запрос не тратит время на аккаунт после 429");

  seen.length = 0;
  await assert.rejects(() => runProviderChain([candidate("limited", "m3")], undefined, "food", attempt));
  assert.deepEqual(seen, ["limited"], "единственный кандидат пробуется, даже если недавно был 429");
});

test("окно сводки: [время, время + 30 минут), не точная минута и не «всё после»", () => {
  const at = minuteOfDay("19:30");
  assert.equal(inSummaryWindow(at - 1, at, 30), false);
  assert.equal(inSummaryWindow(at, at, 30), true);
  assert.equal(inSummaryWindow(at + 29, at, 30), true);
  assert.equal(inSummaryWindow(at + 30, at, 30), false);
  // The daily cron mode keeps working with a window as long as the day.
  assert.equal(inSummaryWindow(at + 300, at, 1440), true);
});

test("cron: рассылки раньше повторов, повтор старого update не разбирается молча", async () => {
  const { db } = await createCommandDb();
  const owner = await ownerOf(db, newTelegramId());
  // The old update has no private chat in its payload, so nothing is sent to Telegram.
  const [stale] = await db.insert(schema.telegramUpdates).values({
    ownerId: owner.id,
    telegramUpdateId: 900_001,
    payload: { update_id: 900_001 },
    status: "failed",
    attemptCount: 1,
    receivedAt: new Date(Date.now() - 10 * 3600 * 1000),
  }).returning();
  const { runScheduledTasks } = await import("../src/server/cron");
  const phases: string[] = [];
  const result = await runScheduledTasks({ onPhase: (phase) => phases.push(phase) });
  assert.deepEqual(phases, ["owners", "cleanup", "retry"]);
  assert.equal(result.failed, 0);
  const [row] = await db.select().from(schema.telegramUpdates).where(eq(schema.telegramUpdates.id, stale.id));
  assert.equal(row.status, "failed");
  assert.equal(row.lastError, "stale");
  assert.equal(row.attemptCount, 3, "update больше не повторяется");
});

test("cron: вне окна сводка не отправляется и не строится", async () => {
  const { db } = await createCommandDb();
  const owner = await ownerOf(db, newTelegramId());
  await db.update(schema.ownerSettings).set({ summaryTime: "03:00", dailySummaryEnabled: true, timezone: "UTC" }).where(eq(schema.ownerSettings.id, owner.id));
  const { runScheduledTasks } = await import("../src/server/cron");
  // 12:00 UTC is far from 03:00: with Telegram unreachable, any send attempt would count as a failure.
  const result = await runScheduledTasks({ now: new Date("2026-11-17T12:00:00Z") });
  assert.deepEqual(result, { sent: 0, failed: 0, skippedOwners: 0 });
});
