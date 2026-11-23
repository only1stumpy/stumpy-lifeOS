import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";

/** The external scheduler (cron-job.org) calls /api/cron every 30 minutes; each call leaves a row in admin_cron_runs. */
export const UPTIME_RETENTION_DAYS = 90;
const HOUR_MS = 3600_000;
const DAY_HOURS = 24;

/** One hour of cron history: how many calls arrived and how many of them reported failures. */
export type HourBucket = { hour: number; runs: number; failed: number };
export type HourState = "up" | "degraded" | "down" | "unknown";

export type UptimeSummary = {
  generatedAt: string;
  /** Percent of hours (one decimal) with at least one cron call; null when there is no history for the window yet. */
  day: number | null;
  week: number | null;
  month: number | null;
  quarter: number | null;
  /** Completed hours without a single call in the last 7 days. */
  missedHours7d: number;
  /** Completed hours in the last 7 days where every call reported failures. */
  degradedHours7d: number;
  /** 168 hourly cells for the last 7 days, oldest first. */
  hours: HourState[];
  /** 90 daily cells, oldest first: share of "up" hours among known ones, null before the monitoring started. */
  days: { date: string; percent: number | null }[];
  firstRunAt: string | null;
};

const percent = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
const hourIndex = (date: Date) => Math.floor(date.getTime() / HOUR_MS);

/**
 * Pure calculation. An hour counts as up when at least one call reached the service (the interval is 30 minutes, so one
 * lost call does not make an outage). Hours before the first recorded call are unknown, not down; the current hour is
 * not judged until it ends. A call with failures is reachable but degraded: it keeps the hour up in the percentage.
 */
export function computeUptime(buckets: HourBucket[], now: Date = new Date()): UptimeSummary {
  const byHour = new Map(buckets.map((bucket) => [bucket.hour, bucket]));
  const current = hourIndex(now);
  const firstHour = buckets.length ? Math.min(...buckets.map((bucket) => bucket.hour)) : null;

  const stateOf = (hour: number): HourState => {
    if (firstHour === null || hour < firstHour) return "unknown";
    const bucket = byHour.get(hour);
    if (!bucket || bucket.runs === 0) return "down";
    return bucket.failed >= bucket.runs ? "degraded" : "up";
  };
  const window = (hours: number) => {
    let known = 0;
    let up = 0;
    for (let hour = current - hours; hour < current; hour += 1) {
      const state = stateOf(hour);
      if (state === "unknown") continue;
      known += 1;
      if (state !== "down") up += 1;
    }
    return percent(up, known);
  };

  const hours: HourState[] = [];
  for (let hour = current - 7 * DAY_HOURS; hour < current; hour += 1) hours.push(stateOf(hour));

  const days: UptimeSummary["days"] = [];
  const currentDay = Math.floor(current / DAY_HOURS);
  for (let day = currentDay - (UPTIME_RETENTION_DAYS - 1); day <= currentDay; day += 1) {
    let known = 0;
    let up = 0;
    for (let hour = day * DAY_HOURS; hour < (day + 1) * DAY_HOURS && hour < current; hour += 1) {
      const state = stateOf(hour);
      if (state === "unknown") continue;
      known += 1;
      if (state !== "down") up += 1;
    }
    days.push({ date: new Date(day * DAY_HOURS * HOUR_MS).toISOString().slice(0, 10), percent: percent(up, known) });
  }

  return {
    generatedAt: now.toISOString(),
    day: window(24),
    week: window(7 * 24),
    month: window(30 * 24),
    quarter: window(UPTIME_RETENTION_DAYS * 24),
    missedHours7d: hours.filter((state) => state === "down").length,
    degradedHours7d: hours.filter((state) => state === "degraded").length,
    hours,
    days,
    firstRunAt: firstHour === null ? null : new Date(firstHour * HOUR_MS).toISOString(),
  };
}

export async function loadUptime(now: Date = new Date()): Promise<UptimeSummary> {
  const since = new Date(now.getTime() - UPTIME_RETENTION_DAYS * 24 * HOUR_MS);
  const rows = (await getDb().execute(sql`
    SELECT floor(extract(epoch FROM started_at) / 3600)::bigint AS hour, count(*) AS runs, count(*) FILTER (WHERE ok = false) AS failed
    FROM admin_cron_runs WHERE started_at >= ${since.toISOString()}::timestamptz GROUP BY 1`)).rows as { hour: string; runs: string; failed: string }[];
  return computeUptime(rows.map((row) => ({ hour: Number(row.hour), runs: Number(row.runs), failed: Number(row.failed) })), now);
}

/** One line for the admin bot. */
export function uptimeLine(summary: UptimeSummary): string {
  const show = (value: number | null) => (value === null ? "нет данных" : `${value}%`);
  return `Аптайм: 24 ч ${show(summary.day)} · 7 дн ${show(summary.week)} (пропущено часов: ${summary.missedHours7d})`;
}
