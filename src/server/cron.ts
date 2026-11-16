import { and, eq, lte } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { dateKey } from "@/domain/math";
import { AppError } from "@/server/http";
import { describeError, formatErrorInfo, isUndeliverable } from "@/server/diagnostics";
import { getStats, STATS_TTL_MS } from "@/server/admin/stats";
import { withTelegramUser } from "@/server/owner-context";
import { runRetentionCleanup } from "@/server/retention";
import { purgeOldRateLimitCounters } from "@/server/rate-limit";
import {
  purgeOldTelegramUpdates,
  retryFailedTelegramUpdates,
  sendDailySummary,
  sendDuePaymentReminder,
  sendDueDebtReminder,
  sendWeeklySummary,
  sendWeightReminder,
} from "@/server/telegram/bot";
import { inSummaryWindow, minuteOfDay } from "@/domain/notifications";
import { normalizeModules, resolveFeatures } from "@/domain/modules";

/** The route's `maxDuration` is 60 s; the work below must finish inside it with a margin. */
export const CRON_DEADLINE_MS = 57_000;
/** Reminders and summaries first, with their own budget, so that slow retries never starve them. */
const OWNERS_BUDGET_MS = 10_000;
const OWNER_BATCH_SIZE = 3;
/** Retried updates may call the AI chain, so there are only a couple per call. */
const RETRY_UPDATES_PER_RUN = 2;
const DEFAULT_SUMMARY_WINDOW_MINUTES = 30;

export type CronPhase = "owners" | "cleanup" | "retry";

/** `failed` counts real failures; owners who blocked the bot (undeliverable) are expected and counted apart. */
export type CronResult = { sent: number; failed: number; skippedOwners: number; undeliverable: number; errorClasses: Record<string, number> };

/** Order matters: reminders and summaries -> cheap cleanup -> retries of stuck updates (the only step that may take long). */
export async function runScheduledTasks(options: { now?: Date; onPhase?: (phase: CronPhase) => void } = {}): Promise<CronResult> {
  const startedAt = Date.now();
  const now = options.now ?? new Date();
  const dailyMinute = configuredMinute("DAILY_SUMMARY_TIME", "19:30");
  const weeklyMinute = configuredMinute("WEEKLY_SUMMARY_TIME", "19:30");
  const windowMinutes = summaryWindowMinutes();
  const sent: string[] = [];

  options.onPhase?.("owners");
  const owners = await getDb().select().from(schema.ownerSettings).orderBy(schema.ownerSettings.createdAt);
  let failed = 0;
  let skippedOwners = 0;
  let undeliverable = 0;
  const errorClasses: Record<string, number> = {};
  for (let index = 0; index < owners.length; index += OWNER_BATCH_SIZE) {
    if (index > 0 && Date.now() - startedAt > OWNERS_BUDGET_MS) {
      skippedOwners = owners.length - index;
      console.error("LifeOS cron: owners budget exhausted", { skippedOwners });
      break;
    }
    const batch = owners.slice(index, index + OWNER_BATCH_SIZE);
    // One owner failing (for example, a user who blocked the bot) must not stop reminders for everyone else.
    const results = await Promise.all(batch.map(async (owner) => {
      try {
        return { delivered: await processOwner(owner, now, { dailyMinute, weeklyMinute, windowMinutes }) };
      } catch (error) {
        if (isUndeliverable(error)) return { delivered: [] as string[], undeliverable: true };
        const info = formatErrorInfo(describeError(error));
        console.error("LifeOS cron: owner failed", { ownerId: owner.id, error: info });
        errorClasses[info] = (errorClasses[info] ?? 0) + 1;
        return { delivered: [] as string[], failed: true };
      }
    }));
    for (const result of results) {
      sent.push(...result.delivered);
      if ("failed" in result) failed += 1;
      if ("undeliverable" in result) undeliverable += 1;
    }
  }

  options.onPhase?.("cleanup");
  await purgeOldRateLimitCounters().catch(() => console.error("LifeOS cron: rate limit cleanup failed"));
  await purgeOldTelegramUpdates().catch(() => console.error("LifeOS cron: update cleanup failed"));
  await runRetentionCleanup(now);

  options.onPhase?.("retry");
  await retryFailedTelegramUpdates({ maxUpdates: RETRY_UPDATES_PER_RUN, deadlineAt: startedAt + CRON_DEADLINE_MS })
    .catch(() => console.error("LifeOS cron: update retry failed"));

  // Aggregate statistics are recomputed about once a day, and only while there is time left.
  if (startedAt + CRON_DEADLINE_MS - Date.now() > 15_000) {
    await getStats({ refreshIfOlderThanMs: STATS_TTL_MS }).catch(() => console.error("LifeOS cron: statistics refresh failed"));
  }

  return { sent: sent.length, failed, skippedOwners, undeliverable, errorClasses };
}

async function processOwner(
  owner: typeof schema.ownerSettings.$inferSelect,
  now: Date,
  config: { dailyMinute: number; weeklyMinute: number; windowMinutes: number },
): Promise<string[]> {
  const sent: string[] = [];
  await withTelegramUser(owner.telegramUserId, async () => {
    const localDate = dateKey(now, owner.timezone);
    const localTime = getLocalTime(now, owner.timezone);
    const modules = normalizeModules(owner.enabledModules);
    const features = resolveFeatures(modules, owner.disabledFeatures);
    if (features.includes("finance.subscriptions")) {
      const duePayments = await getDb()
        .select()
        .from(schema.recurringPayments)
        .where(and(
          eq(schema.recurringPayments.ownerId, owner.id),
          eq(schema.recurringPayments.isActive, true),
          eq(schema.recurringPayments.reminderEnabled, true),
          lte(schema.recurringPayments.nextDueOn, localDate),
        ));
      for (const payment of duePayments) {
        const delivered = await sendDuePaymentReminder(
          payment.id,
          payment.name,
          Math.round(Number(payment.amount) * 100),
          payment.currency,
          payment.nextDueOn,
        );
        if (delivered) sent.push("payment");
      }
    }

    if (features.includes("finance.debts")) {
      const dueDebts = await getDb()
        .select()
        .from(schema.financeDebts)
        .where(and(
          eq(schema.financeDebts.ownerId, owner.id),
          lte(schema.financeDebts.dueOn, localDate),
        ));
      const debtRepayments = dueDebts.length
        ? await getDb().select().from(schema.financeDebtRepayments).where(eq(schema.financeDebtRepayments.ownerId, owner.id))
        : [];
      for (const debt of dueDebts) {
        const repaid = debtRepayments
          .filter((repayment) => repayment.debtId === debt.id)
          .reduce((sum, repayment) => sum + Math.round(Number(repayment.amount) * 100), 0);
        const remaining = Math.max(0, Math.round(Number(debt.originalAmount) * 100) - repaid);
        if (remaining <= 0 || !debt.dueOn) continue;
        const delivered = await sendDueDebtReminder(debt.id, debt.personName, debt.direction as "i_owe" | "owed_to_me", remaining, debt.dueOn, localDate, owner.baseCurrency ?? "");
        if (delivered) sent.push("debt");
      }
    }

    // Summaries follow the user's own notification settings; an explicit summary time overrides the server defaults.
    // They go out in [time, time + window): the cron runs every 30 minutes, and the per-date delivery key keeps it to once.
    const ownDailyMinute = owner.summaryTime ? minuteOfDay(owner.summaryTime) : config.dailyMinute;
    const ownWeeklyMinute = owner.summaryTime ? minuteOfDay(owner.summaryTime) : config.weeklyMinute;
    const due = (minute: number) => inSummaryWindow(localTime.minuteOfDay, minute, config.windowMinutes);
    if (owner.dailySummaryEnabled && due(ownDailyMinute) && await sendDailySummary(now, owner.timezone)) sent.push("daily");
    if (owner.weeklySummaryEnabled && localTime.weekday === 0 && due(ownWeeklyMinute) && await sendWeeklySummary(now, owner.timezone)) sent.push("weekly");
    if (owner.weightReminderEnabled && features.includes("nutrition.weight") && localTime.weekday === 4 && due(ownWeeklyMinute) && await sendWeightReminder(now, owner.timezone)) sent.push("weight");
  });
  return sent;
}

/** Length of the delivery window after the summary time. 30 matches the 30-minute cron; use 1440 for a once-a-day cron. */
function summaryWindowMinutes(): number {
  const raw = process.env.SUMMARY_WINDOW_MINUTES;
  if (!raw) return DEFAULT_SUMMARY_WINDOW_MINUTES;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 1440) throw new AppError(500, "Проверь настройку SUMMARY_WINDOW_MINUTES.");
  return value;
}

function configuredMinute(name: string, fallback: string): number {
  const value = process.env[name] ?? fallback;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new AppError(500, `Проверь настройку ${name}.`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new AppError(500, `Проверь настройку ${name}.`);
  return hours * 60 + minutes;
}

function getLocalTime(date: Date, timeZone: string): { minuteOfDay: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  const weekday = ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[part("weekday")];
  const hour = Number(part("hour"));
  const minute = Number(part("minute"));
  if (weekday === undefined || !Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new AppError(500, "Не удалось определить местное время.");
  }
  return { minuteOfDay: hour * 60 + minute, weekday };
}
