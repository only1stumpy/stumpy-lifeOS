import { desc, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { readKv, writeKv } from "@/server/admin/kv";
import { RATE_LIMITS } from "@/server/rate-limit";
import { checkReadiness, type Readiness } from "@/server/readiness";
import { MAX_UPDATE_ATTEMPTS } from "@/server/telegram/updates";

const REPO = () => process.env.GITHUB_REPOSITORY?.trim() || "only1stumpy/stumpy-lifeOS";
const BACKUP_CACHE_MS = 10 * 60_000;

export type BackupStatus = { status: string; conclusion: string | null; at: string; url: string } | null;

export type AdminOverview = {
  generatedAt: string;
  health: { version: string; commit: string | null; readiness: Readiness };
  cron: {
    lastRunAgeMinutes: number | null;
    runs: { startedAt: string; durationMs: number | null; ok: boolean | null; sent: number | null; failed: number | null; skippedOwners: number | null; errorClass: string | null }[];
  };
  queue: { byStatus: Record<string, number>; oldestPendingMinutes: number | null; exhausted: number };
  ai: { success24h: number; failures24h: { kind: string; count: number }[] };
  quotas: { limits: { bucket: string; limit: number; windowSeconds: number; exceeded24h: number }[]; neon: string };
  backup: { latest: BackupStatus; workflowUrl: string };
};

export async function loadOverview(now: Date = new Date()): Promise<AdminOverview> {
  const db = getDb();
  const readiness = await checkReadiness();
  const runs = await db.select().from(schema.adminCronRuns).orderBy(desc(schema.adminCronRuns.startedAt)).limit(10);

  const statusRows = (await db.execute(sql`SELECT status, count(*) AS c FROM telegram_updates GROUP BY status`)).rows as { status: string; c: string }[];
  const [pending] = (await db.execute(sql`
    SELECT min(received_at) AS oldest FROM telegram_updates WHERE status IN ('received', 'processing', 'failed')`)).rows as { oldest: string | Date | null }[];
  const [exhausted] = (await db.execute(sql`
    SELECT count(*) AS c FROM telegram_updates WHERE status = 'failed' AND attempt_count >= ${MAX_UPDATE_ATTEMPTS}`)).rows as { c: string }[];

  const since = new Date(now.getTime() - 24 * 3600_000);
  const aiRows = (await db.execute(sql`
    SELECT outcome, coalesce(failure_kind, 'unknown') AS kind, count(*) AS c FROM ai_provider_usage_events
    WHERE occurred_at >= ${since.toISOString()}::timestamptz GROUP BY 1, 2`)).rows as { outcome: string; kind: string; c: string }[];

  // Only counts per bucket: the counter keys contain user ids and are never returned.
  const rules = Object.values(RATE_LIMITS);
  const exceededColumns = sql.join(
    rules.map((rule, index) => sql`count(*) FILTER (WHERE key LIKE ${`${rule.bucket}:%`} AND count > ${rule.limit}) AS ${sql.raw(`b${index}`)}`),
    sql`, `,
  );
  const [exceeded] = (await db.execute(sql`SELECT ${exceededColumns} FROM rate_limit_counters WHERE window_start >= ${since.toISOString()}::timestamptz`)).rows as Record<string, string>[];

  const oldest = pending?.oldest ? new Date(pending.oldest) : null;
  const last = runs[0];
  return {
    generatedAt: now.toISOString(),
    health: {
      version: process.env.NEXT_PUBLIC_APP_VERSION ?? "unknown",
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      readiness,
    },
    cron: {
      lastRunAgeMinutes: last ? Math.round((now.getTime() - last.startedAt.getTime()) / 60_000) : null,
      runs: runs.map((run) => ({
        startedAt: run.startedAt.toISOString(),
        durationMs: run.finishedAt ? run.finishedAt.getTime() - run.startedAt.getTime() : null,
        ok: run.ok, sent: run.sent, failed: run.failed, skippedOwners: run.skippedOwners, errorClass: run.errorClass,
      })),
    },
    queue: {
      byStatus: Object.fromEntries(statusRows.map((row) => [row.status, Number(row.c)])),
      oldestPendingMinutes: oldest ? Math.round((now.getTime() - oldest.getTime()) / 60_000) : null,
      exhausted: Number(exhausted?.c ?? 0),
    },
    ai: {
      success24h: aiRows.filter((row) => row.outcome === "success").reduce((sum, row) => sum + Number(row.c), 0),
      failures24h: aiRows.filter((row) => row.outcome === "failure").map((row) => ({ kind: row.kind, count: Number(row.c) })),
    },
    quotas: {
      limits: rules.map((rule, index) => ({ bucket: rule.bucket, limit: rule.limit, windowSeconds: rule.windowSeconds, exceeded24h: Number(exceeded?.[`b${index}`] ?? 0) })),
      neon: "Расход CU-часов Neon без отдельного API-токена недоступен: смотрите консоль Neon.",
    },
    backup: { latest: await loadBackupStatus(), workflowUrl: `https://github.com/${REPO()}/actions/workflows/backup.yml` },
  };
}

/** Last run of the backup workflow from the public GitHub API (no token); cached so the panel does not hit the unauthenticated limit. */
async function loadBackupStatus(): Promise<BackupStatus> {
  const cached = await readKv<BackupStatus>("backup-status");
  if (cached && Date.now() - cached.updatedAt.getTime() < BACKUP_CACHE_MS) return cached.value;
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO()}/actions/workflows/backup.yml/runs?per_page=1`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "lifeos-admin" },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return cached?.value ?? null;
    const body = (await response.json()) as { workflow_runs?: { status: string; conclusion: string | null; created_at: string; html_url: string }[] };
    const run = body.workflow_runs?.[0];
    const value: BackupStatus = run ? { status: run.status, conclusion: run.conclusion, at: run.created_at, url: run.html_url } : null;
    await writeKv("backup-status", value);
    return value;
  } catch {
    return cached?.value ?? null;
  }
}
