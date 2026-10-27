import { createHmac, timingSafeEqual } from "node:crypto";

export type TelegramMiniAppUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  added_to_attachment_menu?: boolean;
  allows_write_to_pm?: boolean;
  photo_url?: string;
  [key: string]: unknown;
};

export type TelegramInitDataResult =
  | { ok: true; user: TelegramMiniAppUser }
  | { ok: false; reason: string };

export type VerifyTelegramInitDataOptions = {
  botToken: string;
  ownerId: string | number;
  /** Maximum accepted age in seconds. Defaults to 24 hours. */
  maxAgeSeconds?: number;
  /** Current Unix time in seconds, useful for deterministic callers. */
  now?: number;
};

const DEFAULT_MAX_AGE_SECONDS = 24 * 60 * 60;
const MAX_SAFE_ID = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Verifies Telegram Mini App `initData` and restricts it to the configured owner.
 * The input must be Telegram's raw query string; client-side `initDataUnsafe`
 * must never be passed here as a substitute.
 */
export function verifyTelegramInitData(
  raw: string,
  options: VerifyTelegramInitDataOptions,
): TelegramInitDataResult {
  try {
    if (typeof raw !== "string" || raw.length === 0) {
      return { ok: false, reason: "invalid_input" };
    }

    const { botToken, ownerId } = options;
    if (typeof botToken !== "string" || botToken.length === 0) {
      return { ok: false, reason: "invalid_options" };
    }

    const expectedOwnerId = normalizeOwnerId(ownerId);
    if (expectedOwnerId === null) {
      return { ok: false, reason: "invalid_options" };
    }

    const maxAgeSeconds = options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
    const now = options.now ?? Math.floor(Date.now() / 1000);
    if (
      !Number.isSafeInteger(maxAgeSeconds) ||
      maxAgeSeconds <= 0 ||
      !Number.isSafeInteger(now) ||
      now <= 0
    ) {
      return { ok: false, reason: "invalid_options" };
    }

    // URLSearchParams is intentionally used for Telegram's form-style query
    // encoding. Validate escapes first because it otherwise tolerates malformed
    // percent-encoded UTF-8 by replacing it with U+FFFD.
    try {
      decodeURIComponent(raw.replace(/\+/g, " "));
    } catch {
      return { ok: false, reason: "malformed_query" };
    }

    const params = new URLSearchParams(raw);
    const fields = new Map<string, string>();
    for (const [key, value] of params) {
      if (fields.has(key)) {
        return { ok: false, reason: "duplicate_field" };
      }
      fields.set(key, value);
    }

    const receivedHashHex = fields.get("hash");
    if (!receivedHashHex || !/^[a-fA-F0-9]{64}$/.test(receivedHashHex)) {
      return { ok: false, reason: "invalid_hash" };
    }

    const dataCheckString = [...fields.entries()]
      .filter(([key]) => key !== "hash")
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    const secretKey = createHmac("sha256", "WebAppData")
      .update(botToken)
      .digest();
    const expectedHash = createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest();
    const receivedHash = Buffer.from(receivedHashHex, "hex");
    if (!timingSafeEqual(receivedHash, expectedHash)) {
      return { ok: false, reason: "invalid_signature" };
    }

    const authDateValue = fields.get("auth_date");
    if (!authDateValue || !/^\d+$/.test(authDateValue)) {
      return { ok: false, reason: "invalid_auth_date" };
    }
    const authDate = Number(authDateValue);
    if (!Number.isSafeInteger(authDate) || authDate <= 0) {
      return { ok: false, reason: "invalid_auth_date" };
    }
    if (authDate > now) {
      return { ok: false, reason: "auth_date_in_future" };
    }
    if (now - authDate > maxAgeSeconds) {
      return { ok: false, reason: "auth_data_expired" };
    }

    const userValue = fields.get("user");
    if (!userValue) {
      return { ok: false, reason: "missing_user" };
    }

    let user: unknown;
    try {
      user = JSON.parse(userValue);
    } catch {
      return { ok: false, reason: "invalid_user" };
    }
    if (!isTelegramMiniAppUser(user)) {
      return { ok: false, reason: "invalid_user" };
    }
    if (String(user.id) !== expectedOwnerId) {
      return { ok: false, reason: "not_owner" };
    }

    return { ok: true, user };
  } catch {
    // Treat unexpected malformed input and crypto/URL parsing failures as a
    // rejected credential. Never expose or log the bot token or signed data.
    return { ok: false, reason: "invalid_input" };
  }
}

function normalizeOwnerId(ownerId: string | number): string | null {
  if (typeof ownerId === "number") {
    return Number.isSafeInteger(ownerId) && ownerId > 0
      ? String(ownerId)
      : null;
  }

  if (typeof ownerId !== "string" || !/^[1-9]\d*$/.test(ownerId)) {
    return null;
  }

  try {
    return BigInt(ownerId) <= MAX_SAFE_ID ? ownerId : null;
  } catch {
    return null;
  }
}

function isTelegramMiniAppUser(value: unknown): value is TelegramMiniAppUser {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const user = value as Record<string, unknown>;
  return (
    typeof user.id === "number" &&
    Number.isSafeInteger(user.id) &&
    user.id > 0 &&
    typeof user.first_name === "string"
  );
}
