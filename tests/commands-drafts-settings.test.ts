import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { commandSchema } from "@/domain/commands";
import { createCommandDb, newTelegramId, ownerOf, rejectsWith, run, uuid, type CommandDb } from "./helpers/command-db";

describe("черновики, настройки и схема команд", () => {
  let ctx: Awaited<ReturnType<typeof createCommandDb>>;
  let db: CommandDb;
  before(async () => { ctx = await createCommandDb(); db = ctx.db; });
  after(async () => { await ctx.client.close(); });

  const draft = async (ownerId: string, status: "pending" | "confirmed" | "cancelled") => {
    const [row] = await db.insert(s.captureDrafts).values({ ownerId, kind: "nutrition", status, messageText: "тест" }).returning();
    return row;
  };
  const statusOf = async (id: string) => (await db.select().from(s.captureDrafts).where(eq(s.captureDrafts.id, id)))[0].status;

  test("draft.reject: pending становится cancelled, повтор идемпотентен", async () => {
    const tg = newTelegramId();
    const owner = await ownerOf(db, tg);
    const d = await draft(owner.id, "pending");
    await run(tg, { type: "draft.reject", id: d.id });
    assert.equal(await statusOf(d.id), "cancelled");
    await run(tg, { type: "draft.reject", id: d.id });
    assert.equal(await statusOf(d.id), "cancelled");
  });

  test("draft.reject подтверждённого черновика даёт 409 и не меняет статус", async () => {
    const tg = newTelegramId();
    const owner = await ownerOf(db, tg);
    const d = await draft(owner.id, "confirmed");
    await rejectsWith(run(tg, { type: "draft.reject", id: d.id }), 409);
    assert.equal(await statusOf(d.id), "confirmed");
  });

  test("draft.reject чужого или несуществующего черновика даёт 404 и не отменяет чужой", async () => {
    const a = newTelegramId();
    const b = newTelegramId();
    const ownerA = await ownerOf(db, a);
    await ownerOf(db, b);
    const d = await draft(ownerA.id, "pending");
    await rejectsWith(run(b, { type: "draft.reject", id: d.id }), 404);
    await rejectsWith(run(a, { type: "draft.reject", id: uuid() }), 404);
    assert.equal(await statusOf(d.id), "pending");
  });

  test("draft.confirm еды создаёт запись один раз, после отмены даёт 409", async () => {
    const tg = newTelegramId();
    const owner = await ownerOf(db, tg);
    const d = await draft(owner.id, "pending");
    await db.insert(s.nutritionDrafts).values({ ownerId: owner.id, captureDraftId: d.id, name: "Суп", portionLabel: "1", occurredAt: new Date("2026-03-10T12:00:00Z"), estimated: true, calories: "300", proteinGrams: "10", fatGrams: "10", carbsGrams: "30" });
    await run(tg, { type: "draft.confirm", id: d.id });
    await run(tg, { type: "draft.confirm", id: d.id });
    assert.equal((await db.select().from(s.nutritionEntries).where(eq(s.nutritionEntries.ownerId, owner.id))).length, 1);
    assert.equal(await statusOf(d.id), "confirmed");

    const cancelled = await draft(owner.id, "cancelled");
    await rejectsWith(run(tg, { type: "draft.confirm", id: cancelled.id }), 409);
  });

  test("personalization.save сохраняет разделы, функции и сводки; settings.save задаёт часовой пояс и цель", async () => {
    const tg = newTelegramId();
    const owner = await ownerOf(db, tg);
    await run(tg, { type: "personalization.save", modules: ["finance", "gym"], disabledFeatures: [], settings: { dailySummary: true, weeklySummary: false, weightReminder: true, summaryTime: "21:30" } });
    let [row] = await db.select().from(s.ownerSettings).where(eq(s.ownerSettings.id, owner.id));
    assert.deepEqual(row.enabledModules, ["finance", "gym"]);
    assert.equal(row.modulesConfigured, true);
    assert.equal(row.dailySummaryEnabled, true);
    assert.equal(row.weeklySummaryEnabled, false);
    assert.equal(row.summaryTime, "21:30");

    await run(tg, { type: "settings.save", timeZone: "Europe/Chisinau", target: { calories: 2000, proteinGrams: 120, fatGrams: 70, carbsGrams: 220 } });
    [row] = await db.select().from(s.ownerSettings).where(eq(s.ownerSettings.id, owner.id));
    assert.equal(row.timezone, "Europe/Chisinau");
    assert.equal(row.profileOnboardingCompleted, true);
    assert.equal((await db.select().from(s.nutritionTargets).where(eq(s.nutritionTargets.ownerId, owner.id))).length, 1);

    await rejectsWith(run(tg, { type: "settings.save", timeZone: "Mars/Olympus", target: null }), 400);
    [row] = await db.select().from(s.ownerSettings).where(eq(s.ownerSettings.id, owner.id));
    assert.equal(row.timezone, "Europe/Chisinau");
  });

  test("схема отклоняет пустые разделы, повторы, неверное время сводки и неизвестную команду", () => {
    const settings = { dailySummary: true, weeklySummary: true, weightReminder: true, summaryTime: "09:00" };
    assert.throws(() => commandSchema.parse({ type: "personalization.save", modules: [], disabledFeatures: [], settings }));
    assert.throws(() => commandSchema.parse({ type: "personalization.save", modules: ["gym", "gym"], disabledFeatures: [], settings }));
    assert.throws(() => commandSchema.parse({ type: "personalization.save", modules: ["gym"], disabledFeatures: [], settings: { ...settings, summaryTime: "25:99" } }));
    assert.throws(() => commandSchema.parse({ type: "owner.drop-everything" }));
    assert.throws(() => commandSchema.parse({ type: "money.delete", id: "not-a-uuid" }));
  });
});
