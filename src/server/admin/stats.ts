import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { counted, maskCount, type Counted, type Masked } from "@/server/admin/mask";
import { readKv, writeKv } from "@/server/admin/kv";

/**
 * Aggregate usage statistics: only counts and shares. There is no query here that returns a row per user,
 * no identifiers, names or diary content; every count of 1-4 is shown as "<5".
 */
export type AdminStats = {
  computedAt: string;
  audience: {
    total: Masked;
    newDay: Masked; newWeek: Masked; newMonth: Masked;
    dau: Masked; wau: Masked; mau: Masked;
    registrationsByDay: { date: string; count: Masked }[];
  };
  retention: { cohortWeek: string; size: Masked; day1: Counted; day7: Counted; day30: Counted }[];
  onboarding: { consent: Counted; profile: Counted; firstEntry: Counted; aiConnected: Counted };
  modules: { module: string; enabled: Counted; active30d: Counted; entriesPerDay7d: Masked }[];
  channels: { chat: Counted; miniApp: Counted; other: Counted };
  ai: {
    withKeys: Counted;
    byProvider: { provider: string; users: Counted }[];
    events7d: { success: Masked; failures: { kind: string; count: Masked }[] };
  };
  slices: { timezones: { value: string; users: Counted }[]; currencies: { value: string; users: Counted }[] };
};

export const STATS_TTL_MS = 20 * 3600_000;
const KEY = "stats";

type Row = Record<string, unknown>;
const n = (value: unknown) => Number(value ?? 0);
const q = async (query: ReturnType<typeof sql>): Promise<Row[]> => (await getDb().execute(query)).rows as Row[];

export async function computeStats(now: Date = new Date()): Promise<AdminStats> {
  const today = now.toISOString().slice(0, 10);
  const day = (offset: number) => new Date(now.getTime() - offset * 86400_000).toISOString().slice(0, 10);

  const [a] = await q(sql`
    SELECT count(*) AS total,
      count(*) FILTER (WHERE created_at >= ${day(1)}::date) AS new_day,
      count(*) FILTER (WHERE created_at >= ${day(7)}::date) AS new_week,
      count(*) FILTER (WHERE created_at >= ${day(30)}::date) AS new_month,
      count(*) FILTER (WHERE last_active_date = ${today}::date) AS dau,
      count(*) FILTER (WHERE last_active_date >= ${day(6)}::date) AS wau,
      count(*) FILTER (WHERE last_active_date >= ${day(29)}::date) AS mau,
      count(*) FILTER (WHERE privacy_accepted_at IS NOT NULL) AS consent,
      count(*) FILTER (WHERE profile_onboarding_completed) AS profile,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM ai_provider_accounts x WHERE x.owner_id = owner_settings.id)) AS ai,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM nutrition_entries x WHERE x.owner_id = owner_settings.id)
        OR EXISTS (SELECT 1 FROM finance_entries x WHERE x.owner_id = owner_settings.id)
        OR EXISTS (SELECT 1 FROM workout_sessions x WHERE x.owner_id = owner_settings.id)
        OR EXISTS (SELECT 1 FROM weight_entries x WHERE x.owner_id = owner_settings.id)) AS first_entry
    FROM owner_settings`);
  const total = n(a.total);

  const registrations = await q(sql`
    SELECT created_at::date::text AS d, count(*) AS c FROM owner_settings
    WHERE created_at >= ${day(29)}::date GROUP BY 1 ORDER BY 1`);

  const cohorts = await q(sql`
    SELECT date_trunc('week', created_at)::date::text AS w, count(*) AS size,
      count(*) FILTER (WHERE created_at::date + 1 <= ${today}::date) AS e1,
      count(*) FILTER (WHERE created_at::date + 1 <= ${today}::date AND last_active_date >= created_at::date + 1) AS r1,
      count(*) FILTER (WHERE created_at::date + 7 <= ${today}::date) AS e7,
      count(*) FILTER (WHERE created_at::date + 7 <= ${today}::date AND last_active_date >= created_at::date + 7) AS r7,
      count(*) FILTER (WHERE created_at::date + 30 <= ${today}::date) AS e30,
      count(*) FILTER (WHERE created_at::date + 30 <= ${today}::date AND last_active_date >= created_at::date + 30) AS r30
    FROM owner_settings WHERE created_at >= ${day(70)}::date GROUP BY 1 ORDER BY 1 DESC LIMIT 8`);

  const [activity] = await q(sql`
    SELECT
      (SELECT count(DISTINCT owner_id) FROM nutrition_entries WHERE occurred_at >= ${day(30)}::date) AS nutrition_users,
      (SELECT count(DISTINCT owner_id) FROM finance_entries WHERE occurred_at >= ${day(30)}::date) AS finance_users,
      (SELECT count(DISTINCT owner_id) FROM workout_sessions WHERE started_at >= ${day(30)}::date) AS gym_users,
      (SELECT count(*) FROM nutrition_entries WHERE occurred_at >= ${day(7)}::date) AS nutrition_week,
      (SELECT count(*) FROM finance_entries WHERE occurred_at >= ${day(7)}::date) AS finance_week,
      (SELECT count(*) FROM workout_sessions WHERE started_at >= ${day(7)}::date) AS gym_week`);

  const enabled = await q(sql`SELECT m AS module, count(*) AS c FROM owner_settings, unnest(enabled_modules) AS m GROUP BY 1`);
  const enabledOf = (name: string) => n(enabled.find((row) => row.module === name)?.c);
  // Average per day over 7 days; hidden when the weekly total itself is a small group.
  const perDay = (weekTotal: unknown): Masked => (n(weekTotal) > 0 && n(weekTotal) < 5 ? "<5" : Math.round((n(weekTotal) / 7) * 10) / 10);

  const [channels] = await q(sql`
    SELECT
      count(*) FILTER (WHERE source = 'chat') AS chat,
      count(*) FILTER (WHERE source = 'mini_app') AS mini_app,
      count(*) FILTER (WHERE source NOT IN ('chat', 'mini_app')) AS other
    FROM (SELECT source FROM nutrition_entries WHERE occurred_at >= ${day(30)}::date
          UNION ALL SELECT source FROM finance_entries WHERE occurred_at >= ${day(30)}::date) t`);
  const channelTotal = n(channels.chat) + n(channels.mini_app) + n(channels.other);

  const providers = await q(sql`SELECT provider_id AS p, count(DISTINCT owner_id) AS c FROM ai_provider_accounts GROUP BY 1 ORDER BY 2 DESC`);
  const events = await q(sql`
    SELECT outcome, coalesce(failure_kind, 'unknown') AS kind, count(*) AS c FROM ai_provider_usage_events
    WHERE occurred_at >= ${day(7)}::timestamptz GROUP BY 1, 2`);

  const timezones = await q(sql`SELECT timezone AS v, count(*) AS c FROM owner_settings GROUP BY 1 ORDER BY 2 DESC LIMIT 15`);
  const currencies = await q(sql`SELECT base_currency AS v, count(*) AS c FROM owner_settings WHERE base_currency IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 15`);

  const moduleRow = (module: string, users: unknown, weekEntries: unknown) => ({
    module,
    enabled: counted(enabledOf(module), total),
    active30d: counted(n(users), enabledOf(module)),
    entriesPerDay7d: perDay(weekEntries),
  });

  return {
    computedAt: now.toISOString(),
    audience: {
      total: maskCount(total),
      newDay: maskCount(n(a.new_day)), newWeek: maskCount(n(a.new_week)), newMonth: maskCount(n(a.new_month)),
      dau: maskCount(n(a.dau)), wau: maskCount(n(a.wau)), mau: maskCount(n(a.mau)),
      registrationsByDay: registrations.map((row) => ({ date: String(row.d), count: maskCount(n(row.c)) })),
    },
    retention: cohorts.map((row) => ({
      cohortWeek: String(row.w),
      size: maskCount(n(row.size)),
      day1: counted(n(row.r1), n(row.e1)),
      day7: counted(n(row.r7), n(row.e7)),
      day30: counted(n(row.r30), n(row.e30)),
    })),
    onboarding: {
      consent: counted(n(a.consent), total),
      profile: counted(n(a.profile), total),
      firstEntry: counted(n(a.first_entry), total),
      aiConnected: counted(n(a.ai), total),
    },
    modules: [
      moduleRow("nutrition", activity.nutrition_users, activity.nutrition_week),
      moduleRow("finance", activity.finance_users, activity.finance_week),
      moduleRow("gym", activity.gym_users, activity.gym_week),
    ],
    channels: {
      chat: counted(n(channels.chat), channelTotal),
      miniApp: counted(n(channels.mini_app), channelTotal),
      other: counted(n(channels.other), channelTotal),
    },
    ai: {
      withKeys: counted(n(a.ai), total),
      byProvider: providers.map((row) => ({ provider: String(row.p), users: counted(n(row.c), total) })),
      events7d: {
        success: maskCount(events.filter((row) => row.outcome === "success").reduce((sum, row) => sum + n(row.c), 0)),
        failures: events.filter((row) => row.outcome === "failure").map((row) => ({ kind: String(row.kind), count: maskCount(n(row.c)) })),
      },
    },
    slices: {
      timezones: timezones.map((row) => ({ value: String(row.v), users: counted(n(row.c), total) })),
      currencies: currencies.map((row) => ({ value: String(row.v), users: counted(n(row.c), total) })),
    },
  };
}

/** Cached aggregates: recomputed at most once per TTL (the cron refreshes them; the panel only reads). */
export async function getStats(options: { refreshIfOlderThanMs?: number; now?: Date } = {}): Promise<AdminStats | null> {
  const cached = await readKv<AdminStats>(KEY);
  const now = options.now ?? new Date();
  if (cached && now.getTime() - cached.updatedAt.getTime() < (options.refreshIfOlderThanMs ?? Number.POSITIVE_INFINITY)) return cached.value;
  const stats = await computeStats(now);
  await writeKv(KEY, stats);
  return stats;
}

export async function readCachedStats(): Promise<AdminStats | null> {
  return (await readKv<AdminStats>(KEY))?.value ?? null;
}
