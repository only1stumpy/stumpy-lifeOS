import { and, eq, lte } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { dateKey } from "@/domain/math";
import { AppError } from "@/server/http";
import { withTelegramUser } from "@/server/owner-context";
import { purgeOldRateLimitCounters } from "@/server/rate-limit";
import { warnAboutWeakSecretsOnce } from "@/server/security-config";
import {
  retryFailedTelegramUpdates,
  sendDailySummary,
  sendDuePaymentReminder,
  sendDueDebtReminder,
  sendWeeklySummary,
  sendWeightReminder,
} from "@/server/telegram/bot";
import { minuteOfDay } from "@/domain/notifications";
import { normalizeModules, resolveFeatures } from "@/domain/modules";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return runCron(request);
}

export async function POST(request: Request): Promise<Response> {
  return runCron(request);
}

async function runCron(request: Request): Promise<Response> {
  try {
    warnAboutWeakSecretsOnce();
    const secret = process.env.CRON_SECRET;
    if (!secret) throw new AppError(503, "Планировщик ещё не настроен.");
    const authorization = request.headers.get("authorization") ?? "";
    if (!constantTimeEqual(authorization, `Bearer ${secret}`)) {
      throw new AppError(401, "Недействительный запрос планировщика.");
    }

    const now = new Date();
    const dailyMinute = configuredMinute("DAILY_SUMMARY_TIME", "19:30");
    const weeklyMinute = configuredMinute("WEEKLY_SUMMARY_TIME", "19:30");
    const sent: string[] = [];

    await retryFailedTelegramUpdates();
    await purgeOldRateLimitCounters().catch(() => console.error("LifeOS cron: rate limit cleanup failed"));
    const owners = await getDb().select().from(schema.ownerSettings).orderBy(schema.ownerSettings.createdAt);
    let failed = 0;
    for (const owner of owners) {
      // One owner failing (for example, a user who blocked the bot) must not stop reminders for everyone else.
      try {
        await withTelegramUser(owner.telegramUserId, async () => {
          const localDate = dateKey(now, owner.timezone);
          const localTime = getLocalTime(now, owner.timezone);
          const modules = normalizeModules(owner.enabledModules);
          const features = resolveFeatures(modules, owner.disabledFeatures);
          const duePayments = await getDb()
            .select()
            .from(schema.recurringPayments)
            .where(and(
              eq(schema.recurringPayments.ownerId, owner.id),
              eq(schema.recurringPayments.isActive, true),
              eq(schema.recurringPayments.reminderEnabled, true),
              lte(schema.recurringPayments.nextDueOn, localDate),
            ));
          for (const payment of features.includes("finance.subscriptions") ? duePayments : []) {
            const delivered = await sendDuePaymentReminder(
              payment.id,
              payment.name,
              Math.round(Number(payment.amount) * 100),
              payment.currency,
              payment.nextDueOn,
            );
            if (delivered) sent.push("payment");
          }

          const dueDebts = await getDb()
            .select()
            .from(schema.financeDebts)
            .where(and(
              eq(schema.financeDebts.ownerId, owner.id),
              lte(schema.financeDebts.dueOn, localDate),
            ));
          const debtRepayments = await getDb()
            .select()
            .from(schema.financeDebtRepayments)
            .where(eq(schema.financeDebtRepayments.ownerId, owner.id));
          for (const debt of features.includes("finance.debts") ? dueDebts : []) {
            const repaid = debtRepayments
              .filter((repayment) => repayment.debtId === debt.id)
              .reduce((sum, repayment) => sum + Math.round(Number(repayment.amount) * 100), 0);
            const remaining = Math.max(0, Math.round(Number(debt.originalAmount) * 100) - repaid);
            if (remaining <= 0 || !debt.dueOn) continue;
            const delivered = await sendDueDebtReminder(debt.id, debt.personName, debt.direction as "i_owe" | "owed_to_me", remaining, debt.dueOn, localDate, owner.baseCurrency ?? "");
            if (delivered) sent.push("debt");
          }

          // Summaries follow the user's own notification settings; an explicit summary time overrides the server defaults.
          const ownDailyMinute = owner.summaryTime ? minuteOfDay(owner.summaryTime) : dailyMinute;
          const ownWeeklyMinute = owner.summaryTime ? minuteOfDay(owner.summaryTime) : weeklyMinute;
          if (owner.dailySummaryEnabled && localTime.minuteOfDay >= ownDailyMinute && await sendDailySummary(now, owner.timezone)) sent.push("daily");
          if (owner.weeklySummaryEnabled && localTime.weekday === 0 && localTime.minuteOfDay >= ownWeeklyMinute && await sendWeeklySummary(now, owner.timezone)) sent.push("weekly");
          if (owner.weightReminderEnabled && features.includes("nutrition.weight") && localTime.weekday === 4 && localTime.minuteOfDay >= ownWeeklyMinute && await sendWeightReminder(now, owner.timezone)) sent.push("weight");
        });
      } catch (error) {
        failed += 1;
        console.error("LifeOS cron: owner failed", { ownerId: owner.id, error: error instanceof Error ? error.name : "unknown" });
      }
    }

    return Response.json({ ok: failed === 0, sent: sent.length, failed });
  } catch (error) {
    if (error instanceof AppError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "Не удалось выполнить плановые задачи." }, { status: 503 });
  }
}

function configuredMinute(name: string, fallback: string): number {
  const value = process.env[name] ?? fallback;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new AppError(500, `Проверьте настройку ${name}.`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new AppError(500, `Проверьте настройку ${name}.`);
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

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
