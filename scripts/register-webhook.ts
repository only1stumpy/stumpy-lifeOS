import "./load-env";

async function registerWebhook(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const appUrl = process.env.APP_URL;
  if (!token || !secret || !appUrl) {
    throw new Error("Set TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, and APP_URL first.");
  }
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
    throw new Error("TELEGRAM_WEBHOOK_SECRET contains unsupported characters.");
  }

  let webhookUrl: URL;
  try {
    const base = new URL(appUrl);
    if (base.protocol !== "https:") throw new Error();
    webhookUrl = new URL("/api/telegram", base);
  } catch {
    throw new Error("APP_URL must be a valid HTTPS URL.");
  }

  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl.toString(),
        secret_token: secret,
        allowed_updates: ["message", "callback_query"],
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error("Telegram Bot API could not be reached.");
  }

  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new Error("Telegram returned an invalid response.");
  }
  if (!response.ok || !isSuccessfulTelegramResult(result)) {
    throw new Error("Telegram rejected the webhook configuration.");
  }
  console.log("Telegram webhook registered.");
}

function isSuccessfulTelegramResult(value: unknown): value is { ok: true } {
  return typeof value === "object" && value !== null && "ok" in value && value.ok === true;
}

registerWebhook().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Webhook registration failed.");
  process.exitCode = 1;
});
