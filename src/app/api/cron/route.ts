import { and, eq, lte } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { dateKey } from "@/domain/math";
import { AppError } from "@/server/http";
import { ensureOwner } from "@/server/lifeos";
import {
  retryFailedTelegramUpdates,
  sendDailySummary,
  sendDuePaymentReminder,
  sendWeeklySummary,
} from "@/server/telegram/bot";

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
    const secret = process.env.CRON_SECRET;
    if (!secret) throw new AppError(503, "Планировщик ещё не настроен.");
    const authorization = request.headers.get("authorization") ?? "";
    if (!constantTimeEqual(authorization, `Bearer ${secret}`)) {
      throw new AppError(401, "Недействительный запрос планировщика.");
    }

    const owner = await ensureOwner();
    const now = new Date();
    const localDate = dateKey(now, owner.timezone);
    const localTime = getLocalTime(now, owner.timezone);
    const dailyMinute = configuredMinute("DAILY_SUMMARY_TIME", "19:30");
    const weeklyMinute = configuredMinute("WEEKLY_SUMMARY_TIME", "19:30");
    const sent: string[] = [];

    await retryFailedTelegramUpdates();

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
        payment.currency === "USD" ? "USD" : "PRB",
        payment.nextDueOn,
      );
      if (delivered) sent.push(`payment:${payment.id}`);
    }

    if (localTime.minuteOfDay >= dailyMinute) {
      if (await sendDailySummary(now, owner.timezone)) sent.push("daily");
    }

    if (localTime.weekday === 0 && localTime.minuteOfDay >= weeklyMinute) {
      if (await sendWeeklySummary(now, owner.timezone)) sent.push("weekly");
    }

    return Response.json({ ok: true, sent: sent.length });
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
