import { z } from "zod";

export const summaryTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Время в формате ЧЧ:ММ.");

export const notificationSettingsSchema = z.object({
  dailySummary: z.boolean(),
  weeklySummary: z.boolean(),
  weightReminder: z.boolean(),
  /** Local HH:MM for summaries and reminders; null means the server default. */
  summaryTime: summaryTimeSchema.nullable(),
});
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;

/** First-run answer to «how often will you use LifeOS» mapped to notification presets. */
export const USAGE_MODES = {
  daily: { label: "Каждый день", hint: "Дневная и недельная сводки, напоминание взвеситься", dailySummary: true, weeklySummary: true, weightReminder: true },
  weekly: { label: "Пару раз в неделю", hint: "Только недельная сводка и напоминание взвеситься", dailySummary: false, weeklySummary: true, weightReminder: true },
  trial: { label: "Пока просто смотрю", hint: "Без сводок и напоминаний, включи позже в настройках", dailySummary: false, weeklySummary: false, weightReminder: false },
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
