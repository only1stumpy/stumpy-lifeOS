import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { dateKey, instantToZonedLocal, isValidTimeZone, weightDateToStamp, weightStampToDate, zonedLocalToInstant } from "@/domain/math";
import { createCommandDb, newTelegramId, ownerOf, rejectsWith, run, snapshotOf, type CommandDb } from "./helpers/command-db";

const iso = (local: string, zone: string) => zonedLocalToInstant(local, zone)?.toISOString();

describe("пояс: перевод между временем стены и моментом", () => {
  test("полночь и день в Алматы (UTC+5): 01:00 остаётся сегодняшним днём", () => {
    assert.equal(iso("2026-11-16T01:00", "Asia/Almaty"), "2026-11-15T20:00:00.000Z");
    assert.equal(dateKey("2026-11-15T20:00:00.000Z", "Asia/Almaty"), "2026-11-16");
    assert.equal(instantToZonedLocal("2026-11-15T20:00:00.000Z", "Asia/Almaty"), "2026-11-16T01:00");
  });

  test("UTC−10 и UTC+14", () => {
    assert.equal(iso("2026-06-01T00:00", "Pacific/Honolulu"), "2026-06-01T10:00:00.000Z");
    assert.equal(iso("2026-06-01T23:30", "Pacific/Honolulu"), "2026-06-02T09:30:00.000Z");
    assert.equal(iso("2026-06-01T00:00", "Pacific/Kiritimati"), "2026-05-31T10:00:00.000Z");
    assert.equal(instantToZonedLocal("2026-05-31T10:00:00.000Z", "Pacific/Kiritimati"), "2026-06-01T00:00");
  });

  test("DST: пропущенный час сдвигается вперёд, повторяющийся берёт раннее вхождение", () => {
    // Europe/Chisinau: 2026-03-29 03:00 -> 04:00 (EET +2 -> EEST +3); 2026-10-25 04:00 -> 03:00.
    assert.equal(iso("2026-03-29T03:30", "Europe/Chisinau"), "2026-03-29T01:30:00.000Z");
    assert.equal(iso("2026-10-25T03:30", "Europe/Chisinau"), "2026-10-25T00:30:00.000Z");
    assert.equal(iso("2026-03-28T12:00", "Europe/Chisinau"), "2026-03-28T10:00:00.000Z");
    assert.equal(iso("2026-03-30T12:00", "Europe/Chisinau"), "2026-03-30T09:00:00.000Z");
    // Round trip for ordinary times on both sides of the switch.
    for (const local of ["2026-03-29T02:59", "2026-03-29T04:00", "2026-10-25T02:59", "2026-10-25T04:30"]) {
      assert.equal(instantToZonedLocal(zonedLocalToInstant(local, "Europe/Chisinau") as Date, "Europe/Chisinau"), local);
    }
  });

  test("мусор не принимается", () => {
    assert.equal(zonedLocalToInstant("вчера", "UTC"), null);
    assert.equal(isValidTimeZone("Nowhere/City"), false);
    assert.equal(isValidTimeZone("Asia/Almaty"), true);
  });

  test("смена пояса: тот же момент попадает в другой календарный день, а запись не меняется", () => {
    const instant = "2026-11-15T22:30:00.000Z";
    assert.equal(dateKey(instant, "Europe/Chisinau"), "2026-11-16");
    assert.equal(dateKey(instant, "Pacific/Honolulu"), "2026-11-15");
  });
});

describe("вес как календарная дата", () => {
  test("дата не зависит от пояса, штамп восстанавливается без сдвига", () => {
    for (const date of ["2026-06-01", "2026-12-31"]) assert.equal(weightStampToDate(weightDateToStamp(date)), date);
  });

  let ctx: Awaited<ReturnType<typeof createCommandDb>>;
  let db: CommandDb;
  before(async () => { ctx = await createCommandDb(); db = ctx.db; });
  after(async () => { await ctx.client.close(); });

  for (const zone of ["Pacific/Kiritimati", "Pacific/Honolulu", "Europe/Chisinau"]) {
    test(`удаление веса на видимой дате в поясе ${zone}`, async () => {
      const tg = newTelegramId();
      const owner = await ownerOf(db, tg);
      await run(tg, { type: "settings.save", timeZone: zone, target: null });
      await run(tg, { type: "weight.save", date: "2026-03-10", weightKg: 80 });
      const snapshot = await snapshotOf(tg, "2026-03-10");
      assert.deepEqual(snapshot.nutrition.weightHistory.map((v) => v.date), ["2026-03-10"]);
      await run(tg, { type: "weight.delete", date: snapshot.nutrition.weightHistory[0].date });
      assert.equal((await db.select().from(s.weightEntries).where(eq(s.weightEntries.ownerId, owner.id))).length, 0);
      await rejectsWith(run(tg, { type: "weight.delete", date: "2026-03-10" }), 404);
    });
  }
});

describe("settings.save и onboarding", () => {
  let ctx: Awaited<ReturnType<typeof createCommandDb>>;
  let db: CommandDb;
  before(async () => { ctx = await createCommandDb(); db = ctx.db; });
  after(async () => { await ctx.client.close(); });

  test("settings.save меняет пояс, неизвестный пояс даёт 400", async () => {
    const tg = newTelegramId();
    const owner = await ownerOf(db, tg);
    await run(tg, { type: "settings.save", timeZone: "Asia/Almaty", target: null });
    const [row] = await db.select().from(s.ownerSettings).where(eq(s.ownerSettings.id, owner.id));
    assert.equal(row.timezone, "Asia/Almaty");
    await rejectsWith(run(tg, { type: "settings.save", timeZone: "Nowhere/City", target: null }), 400);
  });

  test("onboarding.complete сохраняет пояс устройства; без пояса прежний не меняется", async () => {
    const tg = newTelegramId();
    const owner = await ownerOf(db, tg);
    await run(tg, { type: "onboarding.complete", modules: ["gym"], usage: "weekly", timeZone: "Asia/Almaty", profile: null, target: null, account: null });
    const [row] = await db.select().from(s.ownerSettings).where(eq(s.ownerSettings.id, owner.id));
    assert.equal(row.timezone, "Asia/Almaty");
    const tg2 = newTelegramId();
    const owner2 = await ownerOf(db, tg2);
    await run(tg2, { type: "onboarding.complete", modules: ["gym"], usage: "weekly", profile: null, target: null, account: null });
    const [row2] = await db.select().from(s.ownerSettings).where(eq(s.ownerSettings.id, owner2.id));
    assert.equal(row2.timezone, "Europe/Chisinau");
  });
});
