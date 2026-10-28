import { createHash, timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TELEGRAM_API_URL = "https://api.telegram.org";
const ALLOWED_UPDATES = ["message", "callback_query"] as const;

export async function POST(request: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return setupError("setup_not_configured", 503);

  const authorization = request.headers.get("authorization") ?? "";
  const bearerPrefix = "Bearer ";
  const receivedSecret = authorization.startsWith(bearerPrefix)
    ? authorization.slice(bearerPrefix.length)
    : "";
  if (!receivedSecret || !constantTimeEqual(receivedSecret, cronSecret)) {
    return setupError("unauthorized", 401);
  }

  const rawBody = await request.text();
  let action: string | undefined;
  if (rawBody.length > 0) {
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return setupError("invalid_action", 400);
    }
    if (!isRecord(body)) return setupError("invalid_action", 400);
    if (body.action !== undefined) {
      if (body.action !== "status" && body.action !== "setWebhook") {
        return setupError("invalid_action", 400);
      }
      action = body.action;
    }
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const configuredAppUrl = process.env.APP_URL;
  if (!botToken || !configuredAppUrl) return setupError("setup_not_configured", 503);
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(botToken)) return setupError("setup_not_configured", 503);

  let appUrl: URL;
  try {
    appUrl = new URL(configuredAppUrl);
  } catch {
    return setupError("setup_not_configured", 503);
  }

  if (
    appUrl.protocol !== "https:" ||
    !appUrl.hostname ||
    appUrl.username ||
    appUrl.password ||
    appUrl.pathname !== "/" ||
    appUrl.search ||
    appUrl.hash
  ) {
    return setupError("setup_not_configured", 503);
  }

  const webhookUrl = new URL("/api/telegram", appUrl.origin).toString();

  if (action === "status") return getWebhookStatus(botToken, webhookUrl);

  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!webhookSecret || !/^[A-Za-z0-9_-]{1,256}$/.test(webhookSecret)) {
    return setupError("setup_not_configured", 503);
  }

  try {
    const telegramResponse = await fetch(`${TELEGRAM_API_URL}/bot${botToken}/setWebhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: webhookSecret,
        allowed_updates: ALLOWED_UPDATES,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!telegramResponse.ok) return setupError("telegram_setup_failed", 502);

    const result: unknown = await telegramResponse.json();
    if (isRecord(result) && result.ok === true) return Response.json({ ok: true });
    return setupError("telegram_setup_failed", 502);
  } catch {
    return setupError("telegram_setup_failed", 502);
  }
}

async function getWebhookStatus(botToken: string, webhookUrl: string): Promise<Response> {
  try {
    const telegramResponse = await fetch(`${TELEGRAM_API_URL}/bot${botToken}/getWebhookInfo`, {
      method: "GET",
      signal: AbortSignal.timeout(10_000),
    });
    if (!telegramResponse.ok) return setupError("telegram_status_failed", 502);

    const payload: unknown = await telegramResponse.json();
    if (!isRecord(payload) || payload.ok !== true || !isRecord(payload.result)) {
      return setupError("telegram_status_failed", 502);
    }

    const info = payload.result;
    const lastErrorDate = nonNegativeSafeInteger(info.last_error_date);
    const hasLastErrorMessage = typeof info.last_error_message === "string" && info.last_error_message.length > 0;

    return Response.json(
      {
        ok: true,
        webhookConfigured: info.url === webhookUrl,
        pendingUpdateCount: nonNegativeSafeInteger(info.pending_update_count),
        lastErrorDate,
        hasLastError: lastErrorDate !== null || hasLastErrorMessage,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return setupError("telegram_status_failed", 502);
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left, "utf8").digest();
  const rightDigest = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonNegativeSafeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function setupError(code: string, status: number): Response {
  return Response.json({ error: code }, { status, headers: { "Cache-Control": "no-store" } });
}
