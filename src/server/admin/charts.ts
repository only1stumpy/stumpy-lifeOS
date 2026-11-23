import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";

/**
 * Time series for the admin panel: only counts per hour or day, no identifiers and no content.
 * Buckets are UTC; every bucket of the range is present (zero when nothing happened).
 */
export type Series = { key: string; name: string; values: number[] };
export type Chart = { labels: string[]; series: Series[] };
export type AdminCharts = {
  generatedAt: string;
  /** Last 48 hours by hour. */
  load: Chart;
  /** Last 14 days by day (Telegram update records live 14 days). */
  errors: Chart;
  /** Last 30 days by day. */
  events: Chart;
};

const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;

type Row = Record<string, unknown>;
const q = async (query: ReturnType<typeof sql>): Promise<Row[]> => (await getDb().execute(query)).rows as Row[];

/** Bucket start times (ms), oldest first, the last one is the bucket containing `now`. */
export function bucketStarts(now: Date, count: number, unitMs: number): number[] {
  const last = Math.floor(now.getTime() / unitMs) * unitMs;
  return Array.from({ length: count }, (_, index) => last - (count - 1 - index) * unitMs);
}

/** Puts sparse SQL rows (bucket start + value) onto the full grid. */
export function fillSeries(starts: number[], rows: { at: number; value: number }[]): number[] {
  const byStart = new Map<number, number>();
  for (const row of rows) byStart.set(row.at, (byStart.get(row.at) ?? 0) + row.value);
  return starts.map((start) => byStart.get(start) ?? 0);
}

const toRows = (rows: Row[]) => rows.map((row) => ({ at: new Date(String(row.b)).getTime(), value: Number(row.c ?? 0) }));
const hourLabel = (ms: number) => `${new Date(ms).toISOString().slice(5, 10).split("-").reverse().join(".")} ${new Date(ms).toISOString().slice(11, 13)}:00`;
const dayLabel = (ms: number) => new Date(ms).toISOString().slice(5, 10).split("-").reverse().join(".");

export async function loadCharts(now: Date = new Date()): Promise<AdminCharts> {
  const hours = bucketStarts(now, 48, HOUR_MS);
  const days14 = bucketStarts(now, 14, DAY_MS);
  const days30 = bucketStarts(now, 30, DAY_MS);
  const iso = (ms: number) => new Date(ms).toISOString();

  const [updatesHour, aiHour, updatesFailedDay, aiFailedDay, cronFailedDay, nutritionDay, financeDay, gymDay] = await Promise.all([
    q(sql`SELECT date_trunc('hour', received_at) AS b, count(*) AS c FROM telegram_updates WHERE received_at >= ${iso(hours[0])}::timestamptz GROUP BY 1`),
    q(sql`SELECT date_trunc('hour', occurred_at) AS b, count(*) AS c FROM ai_provider_usage_events WHERE occurred_at >= ${iso(hours[0])}::timestamptz GROUP BY 1`),
    q(sql`SELECT date_trunc('day', received_at) AS b, count(*) AS c FROM telegram_updates WHERE status = 'failed' AND received_at >= ${iso(days14[0])}::timestamptz GROUP BY 1`),
    q(sql`SELECT date_trunc('day', occurred_at) AS b, count(*) AS c FROM ai_provider_usage_events WHERE outcome = 'failure' AND occurred_at >= ${iso(days14[0])}::timestamptz GROUP BY 1`),
    q(sql`SELECT date_trunc('day', started_at) AS b, count(*) AS c FROM admin_cron_runs WHERE ok IS DISTINCT FROM true AND finished_at IS NOT NULL AND started_at >= ${iso(days14[0])}::timestamptz GROUP BY 1`),
    q(sql`SELECT date_trunc('day', occurred_at) AS b, count(*) AS c FROM nutrition_entries WHERE occurred_at >= ${iso(days30[0])}::timestamptz GROUP BY 1`),
    q(sql`SELECT date_trunc('day', occurred_at) AS b, count(*) AS c FROM finance_entries WHERE occurred_at >= ${iso(days30[0])}::timestamptz GROUP BY 1`),
    q(sql`SELECT date_trunc('day', started_at) AS b, count(*) AS c FROM workout_sessions WHERE started_at >= ${iso(days30[0])}::timestamptz GROUP BY 1`),
  ]);

  return {
    generatedAt: now.toISOString(),
    load: {
      labels: hours.map(hourLabel),
      series: [
        { key: "updates", name: "Сообщения и действия в боте", values: fillSeries(hours, toRows(updatesHour)) },
        { key: "ai", name: "ИИ-запросы", values: fillSeries(hours, toRows(aiHour)) },
      ],
    },
    errors: {
      labels: days14.map(dayLabel),
      series: [
        { key: "updates", name: "Не обработаны updates", values: fillSeries(days14, toRows(updatesFailedDay)) },
        { key: "ai", name: "Отказы ИИ", values: fillSeries(days14, toRows(aiFailedDay)) },
        { key: "cron", name: "Сбои cron", values: fillSeries(days14, toRows(cronFailedDay)) },
      ],
    },
    events: {
      labels: days30.map(dayLabel),
      series: [
        { key: "nutrition", name: "Питание", values: fillSeries(days30, toRows(nutritionDay)) },
        { key: "finance", name: "Финансы", values: fillSeries(days30, toRows(financeDay)) },
        { key: "gym", name: "Зал", values: fillSeries(days30, toRows(gymDay)) },
      ],
    },
  };
}
