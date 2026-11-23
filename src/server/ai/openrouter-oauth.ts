import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { AppError } from "@/server/http";
import { connectAiProviderAccount } from "@/server/ai/provider-accounts";
import { decryptProviderApiKey, encryptProviderApiKey } from "@/server/ai/provider-profiles";
import { getAppUrl } from "@/server/telegram/shared";

/** OpenRouter OAuth PKCE: https://openrouter.ai/docs/guides/overview/auth/oauth */
const AUTH_URL = "https://openrouter.ai/auth";
const EXCHANGE_URL = "https://openrouter.ai/api/v1/auth/keys";
const SESSION_TTL_MS = 10 * 60 * 1000;
const EXCHANGE_TIMEOUT_MS = 15_000;
export const OAUTH_CALLBACK_PATH = "api/ai/oauth/openrouter/callback";

export type OAuthStatus = "pending" | "exchanging" | "done" | "failed" | "cancelled" | "expired";

const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex");

/** RFC 7636 S256: base64url(SHA-256(verifier)). */
export function codeChallengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: codeChallengeFor(verifier) };
}

export function openRouterCallbackUrl(): string {
  const appUrl = getAppUrl();
  if (!appUrl) throw new AppError(503, "Вход через OpenRouter сейчас недоступен. Вставь ключ вручную.");
  return new URL(OAUTH_CALLBACK_PATH, appUrl).toString();
}

/** Creates a login attempt for the verified owner and returns the OpenRouter URL to open in the external browser. */
export async function startOpenRouterOAuth(ownerId: string, accountName: string): Promise<{ id: string; authUrl: string; expiresAt: string }> {
  const callbackUrl = openRouterCallbackUrl();
  const db = getDb();
  const { verifier, challenge } = generatePkce();
  const state = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.update(schema.aiOauthSessions)
    .set({ status: "cancelled" })
    .where(and(eq(schema.aiOauthSessions.ownerId, ownerId), eq(schema.aiOauthSessions.status, "pending")));
  // Opportunistic cleanup of this owner's finished attempts keeps the table tiny without a cron job.
  await db.delete(schema.aiOauthSessions)
    .where(and(eq(schema.aiOauthSessions.ownerId, ownerId), lt(schema.aiOauthSessions.expiresAt, new Date(Date.now() - SESSION_TTL_MS))));
  const [row] = await db.insert(schema.aiOauthSessions).values({
    ownerId,
    providerId: "openrouter",
    stateHash: sha256Hex(state),
    encryptedCodeVerifier: encryptProviderApiKey(verifier),
    accountName,
    expiresAt,
  }).returning({ id: schema.aiOauthSessions.id });
  if (!row) throw new AppError(500, "Не удалось начать вход через OpenRouter.");

  const url = new URL(AUTH_URL);
  url.searchParams.set("callback_url", callbackUrl);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("key_label", "LifeOS");
  return { id: row.id, authUrl: url.toString(), expiresAt: expiresAt.toISOString() };
}

/** Status of one attempt, visible only to the owner that started it. */
export async function getOpenRouterOAuthStatus(ownerId: string, id: string): Promise<{ status: OAuthStatus; error?: string }> {
  const [row] = await getDb().select().from(schema.aiOauthSessions)
    .where(and(eq(schema.aiOauthSessions.id, id), eq(schema.aiOauthSessions.ownerId, ownerId))).limit(1);
  if (!row) throw new AppError(404, "Вход не найден.");
  if ((row.status === "pending" || row.status === "exchanging") && row.expiresAt.getTime() <= Date.now()) return { status: "expired" };
  const status = row.status as OAuthStatus;
  return { status, ...(row.error ? { error: row.error } : {}) };
}

export type CallbackOutcome = { ok: true } | { ok: false; message: string };

const CALLBACK_FAILED = "Не удалось завершить вход. Вернись в Mini App и повтори попытку или вставь ключ вручную.";

/**
 * Finishes the login on the redirect from OpenRouter. The browser has no Telegram session, so the only proof is the
 * unguessable `state`: it is matched by hash and the attempt is claimed atomically, which makes it single use.
 */
export async function completeOpenRouterOAuth(params: { state: string | null; code: string | null; error?: string | null }): Promise<CallbackOutcome> {
  const state = params.state?.trim();
  if (!state || state.length > 200) return { ok: false, message: "Ссылка входа недействительна. Вернись в Mini App и начни заново." };
  const db = getDb();
  const stateHash = sha256Hex(state);

  if (params.error || !params.code) {
    await db.update(schema.aiOauthSessions)
      .set({ status: "cancelled", error: "Доступ не был предоставлен. Можно повторить вход или вставить ключ вручную." })
      .where(and(eq(schema.aiOauthSessions.stateHash, stateHash), eq(schema.aiOauthSessions.status, "pending")));
    return { ok: false, message: "Доступ не был предоставлен. Вернись в Mini App: можно повторить вход или вставить ключ вручную." };
  }
  const code = params.code.trim();
  if (!code || code.length > 2_000) return { ok: false, message: CALLBACK_FAILED };

  const [claimed] = await db.update(schema.aiOauthSessions)
    .set({ status: "exchanging" })
    .where(and(
      eq(schema.aiOauthSessions.stateHash, stateHash),
      eq(schema.aiOauthSessions.status, "pending"),
      gt(schema.aiOauthSessions.expiresAt, new Date()),
    ))
    .returning();
  if (!claimed) return { ok: false, message: "Ссылка входа уже использована или устарела. Вернись в Mini App и начни заново." };

  const fail = async (error: string): Promise<CallbackOutcome> => {
    await db.update(schema.aiOauthSessions).set({ status: "failed", error }).where(eq(schema.aiOauthSessions.id, claimed.id));
    return { ok: false, message: `${error} Вернись в Mini App: можно повторить вход или вставить ключ вручную.` };
  };

  let apiKey: string;
  try {
    apiKey = await exchangeCodeForKey(code, decryptProviderApiKey(claimed.encryptedCodeVerifier));
  } catch (error) {
    return fail(error instanceof AppError ? error.message : "Не удалось получить ключ у OpenRouter.");
  }

  try {
    // Same validation, free-model discovery and encryption as a manually pasted key.
    await connectAiProviderAccount(claimed.ownerId, { providerId: "openrouter", name: claimed.accountName, apiKey, freeTierConfirmed: true });
  } catch (error) {
    return fail(error instanceof AppError ? error.message : "Ключ получен, но проверить и сохранить его не удалось.");
  }
  await db.update(schema.aiOauthSessions)
    .set({ status: "done", error: null, encryptedCodeVerifier: "" })
    .where(eq(schema.aiOauthSessions.id, claimed.id));
  return { ok: true };
}

async function exchangeCodeForKey(code: string, codeVerifier: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(EXCHANGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, code_verifier: codeVerifier, code_challenge_method: "S256" }),
      redirect: "error",
      signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
    });
  } catch {
    throw new AppError(502, "OpenRouter не ответил при обмене кода.");
  }
  if (!response.ok) throw new AppError(400, "OpenRouter отклонил код входа (он мог устареть или быть уже использован).");
  const body = await response.json().catch(() => null) as { key?: unknown } | null;
  const key = typeof body?.key === "string" ? body.key.trim() : "";
  if (!key || key.length > 8_192) throw new AppError(502, "OpenRouter вернул неожиданный ответ.");
  return key;
}
