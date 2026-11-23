import { z } from "zod";

export const summaryTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Время в формате ЧЧ:ММ.");

export const notificationSettingsSchema = z.object({
  dailySummary: z.boolean(),
  weeklySummary: z.boolean(),
  /** Sent on the last calendar day of the month; off unless the user turns it on. */
  monthlySummary: z.boolean().default(false),
  weightReminder: z.boolean(),
  /** Every day at the summary time; off by default, independent of the Thursday nudge. */
  dailyWeightReminder: z.boolean().default(false),
  /** Local HH:MM for summaries and reminders; null means the server default. */
  summaryTime: summaryTimeSchema.nullable(),
});
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;

/** First-run answer to «how often will you use LifeOS» mapped to notification presets. */
export const USAGE_MODES = {
  daily: { label: "Каждый день", hint: "Дневная и недельная сводки, напоминание взвеситься", dailySummary: true, weeklySummary: true, monthlySummary: false, weightReminder: true, dailyWeightReminder: false },
  weekly: { label: "Пару раз в неделю", hint: "Только недельная сводка и напоминание взвеситься", dailySummary: false, weeklySummary: true, monthlySummary: false, weightReminder: true, dailyWeightReminder: false },
  trial: { label: "Пока просто смотрю", hint: "Без сводок и напоминаний, включи позже в настройках", dailySummary: false, weeklySummary: false, monthlySummary: false, weightReminder: false, dailyWeightReminder: false },
} as const;
export type UsageMode = keyof typeof USAGE_MODES;
export const usageModeSchema = z.enum(Object.keys(USAGE_MODES) as [UsageMode, ...UsageMode[]]);

/** Minutes since local midnight for an HH:MM string. */
export function minuteOfDay(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * A summary is due in `[summaryMinute, summaryMinute + windowMinutes)` of the owner's local day. The cron runs every
 * 30 minutes, so "at the exact minute" would never match; the window ends at midnight (the delivery key is per local date).
 */
export function inSummaryWindow(localMinute: number, summaryMinute: number, windowMinutes: number): boolean {
  return localMinute >= summaryMinute && localMinute < summaryMinute + windowMinutes;
}

/** True when `localDate` (YYYY-MM-DD, already in the owner's zone) is the last calendar day of its month (28–31, leap years included). */
export function isLastDayOfMonth(localDate: string): boolean {
  const next = new Date(`${localDate}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.getUTCDate() === 1;
}

/** First day of the month of `localDate`. */
export function monthStart(localDate: string): string {
  return `${localDate.slice(0, 8)}01`;
}
