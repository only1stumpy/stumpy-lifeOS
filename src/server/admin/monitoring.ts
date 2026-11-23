import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { raiseAlert } from "@/server/admin/alerts";
import { describeError, formatErrorInfo } from "@/server/diagnostics";
import { runScheduledTasks, type CronResult } from "@/server/cron";
import { MAX_UPDATE_ATTEMPTS } from "@/server/telegram/updates";

/** A run longer than this is close to the function limit and is reported. */
export const SLOW_CRON_MS = 50_000;
/** A run still unfinished after this long was killed by the platform (the function limit is 60 s). */
const STUCK_RUN_MS = 120_000;
/** A pending update older than this is a backlog. */
export const BACKLOG_MINUTES = 30;

export class CronFailure extends Error {
  constructor(readonly info: string) {
    super("cron_failed");
    this.name = "CronFailure";
  }
}

/**
 * Cron with a trail: records the run, alerts the admins about failures, slowness, skipped owners, a previous run that
 * never finished and a backlog of Telegram updates. Rethrows a failed run so the route can answer with a non-200 status.
 */
export async function runMonitoredCron(run: () => Promise<CronResult> = runScheduledTasks, now: () => number = Date.now): Promise<CronResult> {
  const db = getDb();
  await reportStuckRuns();
  const startedAt = now();
  const [record] = await db.insert(schema.adminCronRuns).values({}).returning({ id: schema.adminCronRuns.id });
  const finish = (values: Partial<typeof schema.adminCronRuns.$inferInsert>) =>
    db.update(schema.adminCronRuns).set({ finishedAt: new Date(), ...values }).where(eq(schema.adminCronRuns.id, record.id)).catch(() => undefined);

  let result: CronResult;
  try {
    result = await run();
  } catch (error) {
    const info = formatErrorInfo(describeError(error));
    console.error("LifeOS cron failed", { error: info });
    await finish({ ok: false, errorClass: info });
    await raiseAlert("cron_failed", `cron завершился с ошибкой (${info}).`, { throttleMinutes: 60 });
    throw new CronFailure(info);
  }

  const durationMs = now() - startedAt;
  const ok = result.failed === 0;
  const classes = Object.entries(result.errorClasses).map(([name, count]) => `${name} × ${count}`).join(", ");
  await finish({ ok, sent: result.sent, failed: result.failed, skippedOwners: result.skippedOwners, errorClass: ok ? null : classes.slice(0, 200) });
  if (!ok) await raiseAlert("cron_owner_failures", `cron: не удалось обработать пользователей: ${result.failed} (${classes}). Уведомления могли не уйти.`, { throttleMinutes: 180 });
  if (result.skippedOwners > 0) await raiseAlert("cron_budget", `cron не успел обработать ${result.skippedOwners} пользователей из-за бюджета времени.`, { throttleMinutes: 360 });
  if (durationMs > SLOW_CRON_MS) await raiseAlert("cron_slow", `cron работал ${Math.round(durationMs / 1000)} с при лимите 60 с.`, { throttleMinutes: 360 });
  await checkQueueBacklog();
  return result;
}

/** A run record without finish time that is older than the function limit: the platform killed the function. */
async function reportStuckRuns(): Promise<void> {
  try {
    const stuck = await getDb()
      .update(schema.adminCronRuns)
      .set({ ok: false, finishedAt: new Date(), errorClass: "killed_or_timeout" })
      .where(and(isNull(schema.adminCronRuns.finishedAt), lt(schema.adminCronRuns.startedAt, new Date(Date.now() - STUCK_RUN_MS))))
      .returning({ id: schema.adminCronRuns.id });
    if (stuck.length > 0) await raiseAlert("cron_stuck", `предыдущий вызов cron не завершился (превышено время функции): ${stuck.length}.`, { throttleMinutes: 60 });
  } catch {
    console.error("LifeOS cron: stuck run check failed");
  }
}

export async function checkQueueBacklog(): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - BACKLOG_MINUTES * 60_000);
    const [row] = (await getDb().execute(sql`
      SELECT count(*) AS c FROM telegram_updates
      WHERE received_at < ${cutoff.toISOString()}::timestamptz
        AND (status IN ('received', 'processing') OR (status = 'failed' AND attempt_count < ${MAX_UPDATE_ATTEMPTS}))`)).rows as { c: string }[];
    const count = Number(row?.c ?? 0);
    if (count > 0) await raiseAlert("queue_backlog", `очередь Telegram updates: ${count} необработанных старше ${BACKLOG_MINUTES} минут.`, { throttleMinutes: 360 });
    return count;
  } catch {
    console.error("LifeOS cron: backlog check failed");
    return 0;
  }
}
