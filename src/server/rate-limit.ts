import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { AppError } from "@/server/http";

export type RateLimitRule = { bucket: string; limit: number; windowSeconds: number; message: string };

/** Per verified Telegram user unless noted; counters live in Postgres (fixed windows). */
export const RATE_LIMITS = {
  commands: { bucket: "commands", limit: 120, windowSeconds: 60, message: "Слишком много действий подряд. Подожди минуту." },
  snapshot: { bucket: "snapshot", limit: 120, windowSeconds: 60, message: "Слишком много обновлений подряд. Подожди минуту." },
  aiProviders: { bucket: "ai-providers", limit: 30, windowSeconds: 60, message: "Слишком много запросов к настройкам ИИ. Подожди минуту." },
  aiQuotas: { bucket: "ai-quotas", limit: 30, windowSeconds: 60, message: "Слишком много запросов лимитов. Подожди минуту." },
  export: { bucket: "export", limit: 5, windowSeconds: 3600, message: "Экспорт данных доступен не чаще пяти раз в час." },
  admin: { bucket: "admin", limit: 60, windowSeconds: 60, message: "Слишком много запросов админ-панели. Подожди минуту." },
  telegramMessages: { bucket: "telegram-messages", limit: 60, windowSeconds: 60, message: "Слишком много сообщений подряд." },
  /** Global (all users together): caps how many new profiles open registration can create per hour. */
  newProfiles: { bucket: "new-profiles", limit: 60, windowSeconds: 3600, message: "Сервис сейчас не принимает новых пользователей. Попробуй позже." },
} satisfies Record<string, RateLimitRule>;

/** Anything with a drizzle-style insert; lets tests pass an in-memory database. */
type CounterDatabase = Pick<ReturnType<typeof getDb>, "insert">;

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

/**
 * Counts one request in the current fixed window. Fails open: if the counter table is missing or the
 * database errors, the request is allowed and the problem is logged, so the limiter can never take the service down.
 */
export async function consumeRateLimit(
  database: CounterDatabase,
  rule: RateLimitRule,
  subject: string,
  now: Date = new Date(),
): Promise<RateLimitResult> {
  const windowMs = rule.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  try {
    const [row] = await database
      .insert(s.rateLimitCounters)
      .values({ key: `${rule.bucket}:${subject}`, windowStart, count: 1 })
      .onConflictDoUpdate({ target: [s.rateLimitCounters.key, s.rateLimitCounters.windowStart], set: { count: sql`${s.rateLimitCounters.count} + 1` } })
      .returning({ count: s.rateLimitCounters.count });
    const count = row?.count ?? 1;
    const retryAfterSeconds = Math.max(1, Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000));
    return { allowed: count <= rule.limit, retryAfterSeconds };
  } catch (error) {
    console.error("LifeOS rate limit unavailable, allowing request", { bucket: rule.bucket, error: error instanceof Error ? error.name : "unknown" });
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

/** Throws a 429 AppError when the subject exceeded the rule. */
export async function enforceRateLimit(rule: RateLimitRule, subject: string | number): Promise<void> {
  const result = await consumeRateLimit(getDb(), rule, String(subject));
  if (!result.allowed) throw new AppError(429, rule.message, result.retryAfterSeconds);
}

/** Removes counters of finished windows; called from the cron job. */
export async function purgeOldRateLimitCounters(now: Date = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - 2 * 24 * 3600 * 1000);
  await getDb().delete(s.rateLimitCounters).where(sql`${s.rateLimitCounters.windowStart} < ${cutoff}`);
}
