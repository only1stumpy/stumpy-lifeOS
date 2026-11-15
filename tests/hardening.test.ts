import assert from "node:assert/strict";
import test from "node:test";
import { commandSchema } from "../src/domain/commands";
import { PRIVACY_POLICY_VERSION } from "../src/domain/privacy";
import { analyzeMessage } from "../src/server/ai/analyze";
import { AIAnalysisError } from "../src/server/ai/types";
import { resolveTelegramUserId, withTelegramUser } from "../src/server/owner-context";
import { MIN_SECRET_LENGTH, weakSecretWarnings } from "../src/server/security-config";
import { securityHeaders } from "../src/server/security-headers";

test("запасного владельца нет: без контекста Telegram-пользователь не определяется", () => {
  const previous = process.env.TELEGRAM_OWNER_ID;
  process.env.TELEGRAM_OWNER_ID = "4242";
  try {
    assert.equal(resolveTelegramUserId(), undefined);
    assert.equal(withTelegramUser("777", () => resolveTelegramUserId()), "777");
    assert.equal(resolveTelegramUserId("55"), "55");
  } finally {
    if (previous === undefined) delete process.env.TELEGRAM_OWNER_ID;
    else process.env.TELEGRAM_OWNER_ID = previous;
  }
});

test("ключи ИИ из окружения не обслуживают пользователя без собственных ключей", async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousFlag = process.env.LIFEOS_ALLOW_ENV_AI_KEYS;
  process.env.GEMINI_API_KEY = "deployer-key";
  delete process.env.LIFEOS_ALLOW_ENV_AI_KEYS;
  const oldFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return new Response("{}", { status: 200 }); };
  try {
    await assert.rejects(
      () => analyzeMessage({ text: "съел суп", timeZone: "Europe/Chisinau", now: "2026-10-29T12:00:00.000Z" }),
      (error: unknown) => error instanceof AIAnalysisError && error.code === "not_configured",
    );
    assert.equal(called, false);
  } finally {
    globalThis.fetch = oldFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
    if (previousFlag === undefined) delete process.env.LIFEOS_ALLOW_ENV_AI_KEYS;
    else process.env.LIFEOS_ALLOW_ENV_AI_KEYS = previousFlag;
  }
});

test("слабые секреты распознаются, значения не попадают в сообщения", () => {
  assert.deepEqual(weakSecretWarnings({}), []);
  const short = weakSecretWarnings({ CRON_SECRET: "abc123" });
  assert.equal(short.length, 1);
  assert.ok(short[0].includes("CRON_SECRET") && !short[0].includes("abc123"));
  assert.equal(weakSecretWarnings({ TELEGRAM_WEBHOOK_SECRET: "a".repeat(MIN_SECRET_LENGTH) }).length, 1);
  assert.deepEqual(weakSecretWarnings({ CRON_SECRET: "k9Xv2mQz7LpR4tYw8NcB6hJd3FgS5aUe" }), []);
});

test("заголовки безопасности разрешают только Telegram во фреймах и закрывают базовые риски", () => {
  const headers = Object.fromEntries(securityHeaders().map((header) => [header.key, header.value]));
  assert.ok(headers["Content-Security-Policy"].includes("frame-ancestors 'self' https://web.telegram.org"));
  assert.ok(headers["Content-Security-Policy"].includes("object-src 'none'"));
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.ok(headers["Strict-Transport-Security"].startsWith("max-age="));
  assert.ok(headers["Referrer-Policy"]);
});

test("удаление аккаунта требует точного слова подтверждения, согласие требует версию", () => {
  assert.equal(commandSchema.safeParse({ type: "account.delete", confirmation: "УДАЛИТЬ" }).success, true);
  assert.equal(commandSchema.safeParse({ type: "account.delete", confirmation: "удалить" }).success, false);
  assert.equal(commandSchema.safeParse({ type: "account.delete" }).success, false);
  assert.equal(commandSchema.safeParse({ type: "privacy.accept", version: PRIVACY_POLICY_VERSION }).success, true);
  assert.equal(commandSchema.safeParse({ type: "privacy.accept" }).success, false);
});

test("склонение по числу даёт верную форму, включая 11-14 и дробные значения", async () => {
  const { plural } = await import("../src/domain/plural");
  const forms = (n: number) => plural(n, "запись", "записи", "записей");
  assert.deepEqual([0, 1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111, 112].map(forms), [
    "записей", "запись", "записи", "записи", "записей", "записей", "записей", "записей", "запись", "записи", "записей", "запись", "записей", "записей",
  ]);
  assert.equal(forms(2.9), "записи");
  assert.equal(forms(-1), "запись");
});
