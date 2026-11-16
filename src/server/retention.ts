import { and, isNotNull, isNull, lt, or, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { CLARIFICATION_TTL_MS } from "@/server/ai/clarification";

const DAY_MS = 24 * 3600 * 1000;

/** A draft that nobody confirmed or cancelled expires after this many days. */
export const DRAFT_TTL_DAYS = 7;
/** Usage counters only feed the 24-hour quota view; older rows are noise. */
export const USAGE_EVENT_RETENTION_DAYS = 30;
/** Delivery keys only prevent duplicate reminders; they are not needed long after the day they refer to. */
export const NOTIFICATION_DELIVERY_RETENTION_DAYS = 90;

export function draftExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + DRAFT_TTL_DAYS * DAY_MS);
}

/** Closes pending drafts past their expiry (or, for old rows without one, older than the TTL) and drops their source text. */
export async function expirePendingDrafts(now: Date = new Date()): Promise<void> {
  const legacyCutoff = new Date(now.getTime() - DRAFT_TTL_DAYS * DAY_MS);
  await getDb().update(schema.captureDrafts)
    .set({ status: "expired", messageText: null, updatedAt: now })
    .where(and(
      eq(schema.captureDrafts.status, "pending"),
      or(
        and(isNotNull(schema.captureDrafts.expiresAt), lt(schema.captureDrafts.expiresAt, now)),
        and(isNull(schema.captureDrafts.expiresAt), lt(schema.captureDrafts.createdAt, legacyCutoff)),
      ),
    ));
}

/** Leftover source text of drafts that are no longer pending. */
export async function clearClosedDraftTexts(): Promise<void> {
  await getDb().update(schema.captureDrafts)
    .set({ messageText: null })
    .where(and(isNotNull(schema.captureDrafts.messageText), or(eq(schema.captureDrafts.status, "confirmed"), eq(schema.captureDrafts.status, "cancelled"), eq(schema.captureDrafts.status, "expired"))));
}

/** The AI clarification history lives for 30 minutes; anything older is removed even if the user never answered. */
export async function clearStaleClarifications(now: Date = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - CLARIFICATION_TTL_MS);
  await getDb().update(schema.ownerSettings)
    .set({ aiClarificationHistory: null, aiClarificationUpdatedAt: null })
    .where(and(isNotNull(schema.ownerSettings.aiClarificationUpdatedAt), lt(schema.ownerSettings.aiClarificationUpdatedAt, cutoff)));
}

export async function purgeOldUsageEvents(now: Date = new Date()): Promise<void> {
  await getDb().delete(schema.aiProviderUsageEvents)
    .where(lt(schema.aiProviderUsageEvents.occurredAt, new Date(now.getTime() - USAGE_EVENT_RETENTION_DAYS * DAY_MS)));
}

export async function purgeOldNotificationDeliveries(now: Date = new Date()): Promise<void> {
  await getDb().delete(schema.notificationDeliveries)
    .where(lt(schema.notificationDeliveries.createdAt, new Date(now.getTime() - NOTIFICATION_DELIVERY_RETENTION_DAYS * DAY_MS)));
}

/** Every step is independent: one failing must not leave the others undone. */
export async function runRetentionCleanup(now: Date = new Date()): Promise<void> {
  const steps: Array<[string, () => Promise<void>]> = [
    ["drafts", () => expirePendingDrafts(now)],
    ["draft texts", clearClosedDraftTexts],
    ["clarifications", () => clearStaleClarifications(now)],
    ["usage events", () => purgeOldUsageEvents(now)],
    ["deliveries", () => purgeOldNotificationDeliveries(now)],
  ];
  for (const [name, run] of steps) await run().catch(() => console.error(`LifeOS cron: ${name} cleanup failed`));
}
