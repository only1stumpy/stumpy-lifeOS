import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { commandSchema } from "@/domain/commands";
import { consentState, HEALTH_CONSENT_VERSION, PRIVACY_POLICY_VERSION } from "@/domain/privacy";
import { connectAiProviderAccount } from "@/server/ai/provider-accounts";
import { clearClosedDraftTexts, clearStaleClarifications, expirePendingDrafts, purgeOldNotificationDeliveries, purgeOldUsageEvents } from "@/server/retention";
import { createCommandDb, newTelegramId, ownerOf, rejectsWith, run, snapshotOf, uuid, type CommandDb } from "./helpers/command-db";

const BOT_TOKEN = "123456:route-test-token";
Object.assign(process.env, { TELEGRAM_BOT_TOKEN: BOT_TOKEN });
const initData = (userId: number) => {
  const fields: [string, string][] = [["auth_date", String(Math.floor(Date.now() / 1000))], ["query_id", "AAE-consent"], ["user", JSON.stringify({ id: userId, first_name: "T" })]];
  const check = [...fields].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("\n");
  const params = new URLSearchParams(fields);
  params.append("hash", createHmac("sha256", createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest()).update(check).digest("hex"));
  return params.toString();
};
const signed = (path: string, userId: number, init: RequestInit = {}) =>
  new Request(`http://localhost${path}`, { ...init, headers: { authorization: `tma ${initData(userId)}`, "content-type": "application/json", ...(init.headers as Record<string, string> | undefined) } });
const food = () => ({ type: "food.save", clientRequestId: uuid(), label: "Омлет", portionLabel: "1 порция", occurredAt: "2026-03-10T12:00:00.000Z", calories: 250, proteinGrams: 20, fatGrams: 10, carbsGrams: 15 });

describe("согласие: сервер отвечает 403 без него, кроме прав субъекта", () => {
  let ctx: Awaited<ReturnType<typeof createCommandDb>>;
  let db: CommandDb;
  before(async () => { ctx = await createCommandDb(); db = ctx.db; });
  after(async () => { await ctx.client.close(); });

  test("consentState: сначала политика, потом данные о здоровье", () => {
    assert.equal(consentState({ privacyPolicyVersion: null, healthConsentVersion: null }), "policy");
    assert.equal(consentState({ privacyPolicyVersion: "1.0", healthConsentVersion: HEALTH_CONSENT_VERSION }), "policy", "старая версия политики");
    assert.equal(consentState({ privacyPolicyVersion: PRIVACY_POLICY_VERSION, healthConsentVersion: null }), "health");
    assert.equal(consentState({ privacyPolicyVersion: PRIVACY_POLICY_VERSION, healthConsentVersion: HEALTH_CONSENT_VERSION }), "ok");
  });

  test("подписанная команда без согласия получает 403 и ничего не пишет", async () => {
    const tg = newTelegramId();
    await rejectsWith(run(tg, food(), { consent: false }), 403);
    const [owner] = await db.select().from(s.ownerSettings).where(eq(s.ownerSettings.telegramUserId, tg));
    assert.equal((await db.select().from(s.nutritionEntries).where(eq(s.nutritionEntries.ownerId, owner.id))).length, 0);
  });

  test("после политики без согласия на здоровье записи всё ещё закрыты, после обоих согласий проходят", async () => {
    const tg = newTelegramId();
    await run(tg, { type: "privacy.accept", version: PRIVACY_POLICY_VERSION, adultConfirmed: true }, { consent: false });
    await rejectsWith(run(tg, food(), { consent: false }), 403);
    await run(tg, { type: "privacy.health.accept", version: HEALTH_CONSENT_VERSION }, { consent: false });
    await run(tg, food(), { consent: false });
    const owner = await ownerOf(db, tg);
    assert.equal((await db.select().from(s.nutritionEntries).where(eq(s.nutritionEntries.ownerId, owner.id))).length, 1);
  });

  test("устаревшую версию политики или согласия принять нельзя (409)", async () => {
    const tg = newTelegramId();
    await rejectsWith(run(tg, { type: "privacy.accept", version: "0.1", adultConfirmed: true }, { consent: false }), 409);
    await rejectsWith(run(tg, { type: "privacy.accept", version: PRIVACY_POLICY_VERSION, adultConfirmed: true, healthVersion: "0.1" }, { consent: false }), 409);
  });

  test("отзыв согласия на здоровье снова закрывает записи, а удаление данных остаётся доступным", async () => {
    const tg = newTelegramId();
    await run(tg, food());
    await run(tg, { type: "privacy.health.revoke" }, { consent: false });
    await rejectsWith(run(tg, food(), { consent: false }), 403);
    assert.equal((await snapshotOf(tg)).settings.healthConsentVersion, null, "bootstrap работает без согласия");
    await run(tg, { type: "account.delete", confirmation: "УДАЛИТЬ" }, { consent: false });
    const rows = await db.select().from(s.ownerSettings).where(eq(s.ownerSettings.telegramUserId, tg));
    assert.equal(rows.length, 0);
  });

  test("после новой версии политики согласие нужно заново, а удаление и экспорт доступны без него", async () => {
    const tg = newTelegramId();
    await ownerOf(db, tg);
    await db.update(s.ownerSettings).set({ privacyPolicyVersion: "1.0" }).where(eq(s.ownerSettings.telegramUserId, tg));
    await rejectsWith(run(tg, food(), { consent: false }), 403);
    const exportRoute = await import("../src/app/api/export/route");
    const uid = Number(tg);
    const response = await exportRoute.GET(signed("/api/export", uid));
    assert.equal(response.status, 200, "экспорт без нового согласия");
    await run(tg, { type: "account.delete", confirmation: "УДАЛИТЬ" }, { consent: false });
  });

  test("/api/commands, /api/ai-providers и /api/ai-quotas отвечают 403 без согласия, а /api/snapshot и privacy.accept — нет", async () => {
    const tg = newTelegramId();
    const uid = Number(tg);
    const commands = await import("../src/app/api/commands/route");
    const providers = await import("../src/app/api/ai-providers/route");
    const quotas = await import("../src/app/api/ai-quotas/route");
    const snapshot = await import("../src/app/api/snapshot/route");
    assert.equal((await commands.POST(signed("/api/commands", uid, { method: "POST", body: JSON.stringify(food()) }))).status, 403);
    assert.equal((await providers.GET(signed("/api/ai-providers", uid))).status, 403);
    assert.equal((await providers.POST(signed("/api/ai-providers", uid, { method: "POST", body: JSON.stringify({ action: "complete-onboarding" }) }))).status, 403);
    assert.equal((await quotas.GET(signed("/api/ai-quotas", uid))).status, 403);
    assert.equal((await snapshot.GET(signed("/api/snapshot", uid))).status, 200);
    const accept = await commands.POST(signed("/api/commands", uid, { method: "POST", body: JSON.stringify({ type: "privacy.accept", version: PRIVACY_POLICY_VERSION, adultConfirmed: true, healthVersion: HEALTH_CONSENT_VERSION }) }));
    assert.equal(accept.status, 200);
    assert.equal((await commands.POST(signed("/api/commands", uid, { method: "POST", body: JSON.stringify(food()) }))).status, 200);
  });

  test("подтверждение 18+ обязательно: без adultConfirmed команда не проходит схему", () => {
    assert.equal(commandSchema.safeParse({ type: "privacy.accept", version: PRIVACY_POLICY_VERSION }).success, false);
    assert.equal(commandSchema.safeParse({ type: "privacy.accept", version: PRIVACY_POLICY_VERSION, adultConfirmed: false }).success, false);
  });
});

describe("провайдеры ИИ: бесплатный тариф подтверждается на сервере", () => {
  test("connectAiProviderAccount отклоняет Gemini и Groq без freeTierConfirmed (OpenRouter подтверждения не требует: каталог только бесплатный) до любых запросов к провайдеру", async () => {
    for (const providerId of ["gemini", "groq"]) {
      await assert.rejects(
        connectAiProviderAccount(uuid(), { providerId, name: "Тест", apiKey: "k".repeat(20) }),
        (error: unknown) => error instanceof Error && error.name === "ZodError",
      );
      await assert.rejects(
        connectAiProviderAccount(uuid(), { providerId, name: "Тест", apiKey: "k".repeat(20), freeTierConfirmed: false }),
        (error: unknown) => error instanceof Error && error.name === "ZodError",
      );
    }
  });
});

describe("хранение: исходный текст не живёт дольше черновика", () => {
  let ctx: Awaited<ReturnType<typeof createCommandDb>>;
  let db: CommandDb;
  before(async () => { ctx = await createCommandDb(); db = ctx.db; });
  after(async () => { await ctx.client.close(); });

  async function pendingDraft(tg: string, text: string, extra: Partial<typeof s.captureDrafts.$inferInsert> = {}) {
    const owner = await ownerOf(db, tg);
    const [draft] = await db.insert(s.captureDrafts).values({ ownerId: owner.id, kind: "nutrition", messageText: text, ...extra }).returning();
    await db.insert(s.nutritionDrafts).values({ ownerId: owner.id, captureDraftId: draft.id, name: "Омлет", portionLabel: "1", calories: "250", proteinGrams: "20", fatGrams: "10", carbsGrams: "15", occurredAt: new Date() });
    await db.update(s.ownerSettings).set({ aiClarificationHistory: [{ role: "user", text }], aiClarificationUpdatedAt: new Date() }).where(eq(s.ownerSettings.id, owner.id));
    return { owner, draft };
  }
  const textOf = async (id: string) => (await db.select().from(s.captureDrafts).where(eq(s.captureDrafts.id, id)))[0];

  test("draft.confirm обнуляет messageText и уточнение", async () => {
    const tg = newTelegramId();
    const { owner, draft } = await pendingDraft(tg, "съел омлет");
    await run(tg, { type: "draft.confirm", id: draft.id });
    assert.equal((await textOf(draft.id)).messageText, null);
    const [after] = await db.select().from(s.ownerSettings).where(eq(s.ownerSettings.id, owner.id));
    assert.equal(after.aiClarificationHistory, null);
  });

  test("draft.reject обнуляет messageText и уточнение", async () => {
    const tg = newTelegramId();
    const { owner, draft } = await pendingDraft(tg, "съел омлет");
    await run(tg, { type: "draft.reject", id: draft.id });
    const row = await textOf(draft.id);
    assert.equal(row.status, "cancelled");
    assert.equal(row.messageText, null);
    const [after] = await db.select().from(s.ownerSettings).where(eq(s.ownerSettings.id, owner.id));
    assert.equal(after.aiClarificationHistory, null);
  });

  test("cron: просроченный черновик истекает без текста, свежий остаётся, старый без expiresAt тоже истекает", async () => {
    const tg = newTelegramId();
    const now = new Date("2026-06-01T12:00:00Z");
    const { draft: expired } = await pendingDraft(tg, "просрочен", { expiresAt: new Date("2026-05-30T00:00:00Z") });
    const { draft: fresh } = await pendingDraft(tg, "свежий", { expiresAt: new Date("2026-06-05T00:00:00Z") });
    const { draft: legacy } = await pendingDraft(tg, "старый", { createdAt: new Date("2026-05-01T00:00:00Z") });
    await expirePendingDrafts(now);
    assert.deepEqual([(await textOf(expired.id)).status, (await textOf(expired.id)).messageText], ["expired", null]);
    assert.deepEqual([(await textOf(legacy.id)).status, (await textOf(legacy.id)).messageText], ["expired", null]);
    assert.deepEqual([(await textOf(fresh.id)).status, (await textOf(fresh.id)).messageText], ["pending", "свежий"]);
  });

  test("cron: остатки текста у закрытых черновиков и устаревшее уточнение очищаются", async () => {
    const tg = newTelegramId();
    const { owner, draft } = await pendingDraft(tg, "остаток");
    await db.update(s.captureDrafts).set({ status: "confirmed" }).where(eq(s.captureDrafts.id, draft.id));
    await db.update(s.ownerSettings).set({ aiClarificationUpdatedAt: new Date(Date.now() - 31 * 60_000) }).where(eq(s.ownerSettings.id, owner.id));
    await clearClosedDraftTexts();
    await clearStaleClarifications();
    assert.equal((await textOf(draft.id)).messageText, null);
    const [after] = await db.select().from(s.ownerSettings).where(eq(s.ownerSettings.id, owner.id));
    assert.equal(after.aiClarificationHistory, null);
  });

  test("cron: старые usage events и notification deliveries удаляются, свежие остаются", async () => {
    const tg = newTelegramId();
    const owner = await ownerOf(db, tg);
    const now = new Date("2026-06-01T12:00:00Z");
    const [account] = await db.insert(s.aiProviderAccounts).values({ ownerId: owner.id, providerId: "groq", name: "a", endpoint: "https://example.com", authHeaderName: "authorization", encryptedApiKey: "x", freeTierConfirmed: true, enabled: true, sortOrder: 0, models: [] }).returning();
    await db.insert(s.aiProviderUsageEvents).values([
      { ownerId: owner.id, accountId: account.id, modelId: "m", outcome: "success", occurredAt: new Date("2026-04-01T00:00:00Z") },
      { ownerId: owner.id, accountId: account.id, modelId: "m", outcome: "success", occurredAt: new Date("2026-05-31T00:00:00Z") },
    ]);
    await db.insert(s.notificationDeliveries).values([
      { ownerId: owner.id, key: "old", createdAt: new Date("2026-01-01T00:00:00Z") },
      { ownerId: owner.id, key: "new", createdAt: new Date("2026-05-31T00:00:00Z") },
    ]);
    await purgeOldUsageEvents(now);
    await purgeOldNotificationDeliveries(now);
    assert.equal((await db.select().from(s.aiProviderUsageEvents).where(eq(s.aiProviderUsageEvents.ownerId, owner.id))).length, 1);
    assert.deepEqual((await db.select().from(s.notificationDeliveries).where(eq(s.notificationDeliveries.ownerId, owner.id))).map((row) => row.key), ["new"]);
  });
});
