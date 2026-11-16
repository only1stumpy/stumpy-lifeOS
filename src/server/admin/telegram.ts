import { describeError, formatErrorInfo } from "@/server/diagnostics";
import { adminBotToken } from "@/server/admin/config";

/** Calls the Bot API of the admin bot. Returns false on any failure; logs only the error class, never the URL or token. */
export async function callAdminBot(method: string, body: Record<string, unknown>): Promise<boolean> {
  const token = adminBotToken();
  if (!token) return false;
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) console.error("LifeOS admin bot request failed", { method, status: response.status });
    return response.ok;
  } catch (error) {
    console.error("LifeOS admin bot request failed", { method, error: formatErrorInfo(describeError(error)) });
    return false;
  }
}

export async function sendAdminMessage(chatId: string | number, text: string, webAppUrl?: string): Promise<boolean> {
  return callAdminBot("sendMessage", {
    chat_id: chatId,
    text,
    ...(webAppUrl ? { reply_markup: { inline_keyboard: [[{ text: "Открыть админ-панель", web_app: { url: webAppUrl } }]] } } : {}),
  });
}
