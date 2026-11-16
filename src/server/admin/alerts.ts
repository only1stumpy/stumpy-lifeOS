import { describeError, formatErrorInfo } from "@/server/diagnostics";
import { adminBotToken, adminTelegramIds } from "@/server/admin/config";
import { readKv, writeKv } from "@/server/admin/kv";
import { sendAdminMessage } from "@/server/admin/telegram";

/**
 * Sends a technical alert to every admin through the admin bot. The text must never contain user data:
 * only counters, error classes and codes. A repeated alert with the same key is suppressed for `throttleMinutes`.
 * Never throws: an alert failure must not break the code that raised it.
 */
export async function raiseAlert(key: string, text: string, options: { throttleMinutes?: number } = {}): Promise<boolean> {
  try {
    if (!adminBotToken() || adminTelegramIds().length === 0) return false;
    const throttleMs = (options.throttleMinutes ?? 360) * 60_000;
    if (throttleMs > 0) {
      const previous = await readKv<unknown>(`alert:${key}`);
      if (previous && Date.now() - previous.updatedAt.getTime() < throttleMs) return false;
    }
    const results = await Promise.all(adminTelegramIds().map((id) => sendAdminMessage(id, `LifeOS: ${text}`)));
    const delivered = results.some(Boolean);
    if (delivered && throttleMs > 0) await writeKv(`alert:${key}`, { sent: true });
    return delivered;
  } catch (error) {
    console.error("LifeOS alert failed", { alert: key, error: formatErrorInfo(describeError(error)) });
    return false;
  }
}
