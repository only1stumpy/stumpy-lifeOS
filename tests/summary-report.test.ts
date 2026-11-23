import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test, { mock } from "node:test";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { buildPeriodReport, periodBounds } from "../src/domain/period-report";
import { createCommandDb, newTelegramId, ownerOf, releaseCommandDb } from "./helpers/command-db";
import { requestedSummaryPeriod, sendDailySummary, sendMonthlySummary, sendWeeklySummary, summaryKeyboard } from "../src/server/telegram/notifications";
import { withTelegramUser } from "../src/server/owner-context";
import { getBot, resetBotForTests } from "../src/server/telegram/client";
import { createBotHarness } from "./helpers/bot-harness";
import { buildHelpSection } from "../src/domain/welcome";

const empty = { foods: [], money: [], weights: [], categories: [], sessions: [], sessionItems: [], sets: [], target: null };
const base = { period: "week" as const, start: "2026-11-16", end: "2026-11-22", timeZone: "UTC", baseCurrency: "PRB", enabledModules: ["nutrition", "finance", "gym"], disabledFeatures: [], ...empty };

test("ручной период: завершённые сутки, неделя и месяц в локальном поясе", () => {
  assert.deepEqual(requestedSummaryPeriod("week", new Date("2026-11-23T00:30:00Z"), "Pacific/Auckland"), { start: "2026-11-16", end: "2026-11-22" });
  assert.deepEqual(requestedSummaryPeriod("week", new Date("2026-11-23T00:30:00Z"), "America/Los_Angeles"), { start: "2026-11-09", end: "2026-11-15" });
  assert.deepEqual(requestedSummaryPeriod("day", new Date("2027-01-01T00:30:00Z"), "America/Los_Angeles"), { start: "2026-12-30", end: "2026-12-30" });
  assert.deepEqual(requestedSummaryPeriod("month", new Date("2028-03-01T00:30:00Z"), "Pacific/Auckland"), { start: "2028-02-01", end: "2028-02-29" });
  assert.deepEqual(requestedSummaryPeriod("month", new Date("2028-03-01T00:30:00Z"), "America/Los_Angeles"), { start: "2028-01-01", end: "2028-01-31" });
});

test("/summary требует согласия, показывает данные своего периода, не занимает плановую доставку и ограничен частотой", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-23T12:00:00Z") });
  const previousUrl = process.env.APP_URL;
  const { db } = await createCommandDb();
  const harness = await createBotHarness();
  process.env.APP_URL = "https://preview.example.test/";
  t.after(async () => {
    await harness.close();
    releaseCommandDb();
    if (previousUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previousUrl;
  });
  const own = newTelegramId(), other = newTelegramId(), stranger = newTelegramId();
  const owner = await ownerOf(db, own);
  const foreign = await ownerOf(db, other);
  await db.update(schema.ownerSettings).set({ timezone: "UTC", enabledModules: ["nutrition"] }).where(eq(schema.ownerSettings.id, owner.id));
  await db.insert(schema.nutritionEntries).values([
    { ownerId: owner.id, name: "Своя еда", portionLabel: "1", calories: "350", proteinGrams: "10", fatGrams: "2", carbsGrams: "50", occurredAt: new Date("2026-11-16T12:00:00Z") },
    { ownerId: owner.id, name: "Вчера", portionLabel: "1", calories: "200", proteinGrams: "10", fatGrams: "2", carbsGrams: "50", occurredAt: new Date("2026-11-22T12:00:00Z") },
    { ownerId: foreign.id, name: "Чужая еда", portionLabel: "1", calories: "999", proteinGrams: "10", fatGrams: "2", carbsGrams: "50", occurredAt: new Date("2026-11-16T12:00:00Z") },
  ]);
  const monday = Math.floor(new Date("2026-11-23T12:00:00Z").getTime() / 1000);
  await harness.deliver(stranger, harness.messageUpdate(stranger, "/summary", monday));
  assert.match(harness.sentTexts().at(-1)!, /принять условия/);
  await db.update(schema.ownerSettings).set({ healthConsentVersion: null }).where(eq(schema.ownerSettings.id, owner.id));
  await harness.deliver(own, harness.messageUpdate(own, "/summary", monday));
  assert.match(harness.sentTexts().at(-1)!, /согласие/);
  await db.update(schema.ownerSettings).set({ healthConsentVersion: owner.healthConsentVersion }).where(eq(schema.ownerSettings.id, owner.id));
  harness.clearCalls();
  await harness.deliver(own, harness.messageUpdate(own, "/summary", monday));
  assert.match(harness.sentTexts()[0], /2026-11-16 — 2026-11-22/);
  assert.match(harness.sentTexts()[0], /550 ккал/);
  assert.doesNotMatch(harness.sentTexts()[0], /999 ккал/);
  const markup = harness.callsTo("sendMessage")[0].payload.reply_markup as { inline_keyboard: { web_app?: { url: string } }[][] };
  assert.equal(new URL(markup.inline_keyboard.flat().find((button) => button.web_app)!.web_app!.url).searchParams.get("start"), "2026-11-16");
  assert.deepEqual(await db.select().from(schema.notificationDeliveries), []);
  await harness.deliver(own, harness.messageUpdate(own, "/summary month", monday));
  assert.match(harness.sentTexts().at(-1)!, /раз в 30 секунд/);
  t.mock.timers.setTime(new Date("2026-11-23T12:00:31Z").getTime());
  await harness.deliver(own, harness.messageUpdate(own, "/summary month", monday));
  assert.match(harness.sentTexts().at(-1)!, /записей в твоих включённых разделах пока нет/);
  t.mock.timers.setTime(new Date("2026-11-23T12:01:01Z").getTime());
  await harness.deliver(own, harness.messageUpdate(own, "/summary day", monday));
  assert.match(harness.sentTexts().at(-1)!, /за вчера · 2026-11-22/);
  assert.match(harness.sentTexts().at(-1)!, /200 \/ /);
  const dayMarkup = harness.callsTo("sendMessage").at(-1)!.payload.reply_markup as { inline_keyboard: { web_app?: { url: string } }[][] };
  assert.equal(new URL(dayMarkup.inline_keyboard[0][0].web_app!.url).searchParams.get("period"), "day");
  assert.equal(new URL(dayMarkup.inline_keyboard[0][0].web_app!.url).searchParams.get("start"), "2026-11-22");
  t.mock.timers.setTime(new Date("2026-11-23T12:01:31Z").getTime());
  await harness.deliver(own, harness.messageUpdate(own, "/summary nonsense", monday));
  assert.match(harness.sentTexts().at(-1)!, /Напиши \/summary/);
  assert.deepEqual(await db.select().from(schema.notificationDeliveries), []);
  await withTelegramUser(own, () => sendWeeklySummary(new Date("2026-11-22T12:00:00Z"), "UTC"));
  assert.equal((await db.select().from(schema.notificationDeliveries)).filter((row) => row.key === "weekly:2026-11-22").length, 1);
  assert.match(harness.sentTexts().at(-1)!, /Вот как прошла неделя/);
  assert.match(buildHelpSection("commands", { modules: ["nutrition"], features: [] })!, /\/summary/);
});

test("границы суток, недели и месяца строго календарные", () => {
  assert.deepEqual(periodBounds("week", "2026-11-16", "2026-11-23"), { start: "2026-11-16", end: "2026-11-22" });
  assert.deepEqual(periodBounds("month", "2028-02-01", "2028-03-01"), { start: "2028-02-01", end: "2028-02-29" });
  assert.deepEqual(periodBounds("day", "2026-11-23", "2026-11-23"), { start: "2026-11-23", end: "2026-11-23" });
  assert.throws(() => periodBounds("week", "2026-11-17", "2026-11-23"));
  assert.throws(() => periodBounds("month", "2026-02-30", "2026-11-23"));
});

test("агрегаты не переносят соседние дни, сохраняют курс операции и скрывают выключенные разделы", () => {
  const food = (date: string, calories: string) => ({ occurredAt: new Date(date), calories, proteinGrams: "20", fatGrams: "10", carbsGrams: "30" });
  const report = buildPeriodReport({ ...base,
    foods: [food("2026-11-15T23:59:00Z", "900"), food("2026-11-16T11:00:00Z", "500"), food("2026-11-18T11:00:00Z", "700")],
    money: [
      { occurredAt: new Date("2026-11-17T12:00:00Z"), entryType: "expense", amount: "10", currency: "USD", rateToBase: "20.0000000000", categoryId: "food" },
      { occurredAt: new Date("2026-11-19T12:00:00Z"), entryType: "income", amount: "12", currency: "PRB", rateToBase: null, categoryId: "salary" },
    ],
    categories: [{ id: "food", name: "Еда" }, { id: "salary", name: "Работа" }],
    weights: [{ occurredAt: new Date("2026-11-16T12:00:00Z"), weightKg: "70" }, { occurredAt: new Date("2026-11-22T12:00:00Z"), weightKg: "69.5" }],
    sessions: [{ id: "s", status: "completed", completedAt: new Date("2026-11-20T12:00:00Z") }],
    sessionItems: [{ id: "i", sessionId: "s" }],
    sets: [{ sessionExerciseId: "i", isCompleted: true, completedAt: new Date("2026-11-20T12:00:00Z"), weightKg: "50", repetitions: 10 }],
  });
  assert.equal(report.nutrition?.total.calories, 1200);
  assert.equal(report.nutrition?.average.calories, 600);
  assert.equal(report.nutrition?.days[1].calories, null);
  assert.equal(report.finance?.expenseMinor, 20_000);
  assert.equal(report.finance?.incomeMinor, 1200);
  assert.equal(report.weight?.change, -0.5);
  assert.deepEqual(report.gym, { workouts: 1, sets: 1, volumeKg: 500 });
  const hidden = buildPeriodReport({ ...base, enabledModules: ["finance"], disabledFeatures: ["nutrition.weight"] });
  assert.equal(hidden.nutrition, undefined);
  assert.equal(hidden.weight, undefined);
  assert.ok(hidden.finance);
});

test("дневная и месячная сводки считают локальный день, но вес по календарной дате", () => {
  const food = (occurredAt: string) => ({ occurredAt: new Date(occurredAt), calories: "400", proteinGrams: "20", fatGrams: "10", carbsGrams: "30" });
  const input = { ...base, timeZone: "Pacific/Auckland", foods: [
    food("2026-10-31T11:30:00Z"), // November 1 locally
    food("2026-11-22T11:30:00Z"), // November 23 locally
  ], weights: [{ occurredAt: new Date("2026-11-23T12:00:00Z"), weightKg: "71" }] };
  const daily = buildPeriodReport({ ...input, period: "day", start: "2026-11-23", end: "2026-11-23" });
  assert.equal(daily.nutrition?.total.calories, 400);
  assert.equal(daily.weight?.first, 71);
  const monthly = buildPeriodReport({ ...input, period: "month", start: "2026-11-01", end: "2026-11-30" });
  assert.equal(monthly.nutrition?.total.calories, 800);
  assert.equal(monthly.nutrition?.loggedDays, 2);
});

test("кнопка сохраняет текстовые действия и передаёт только период и начало", () => {
  const old = { inline_keyboard: [[{ text: "Применить", callback_data: "tgt:1" }]] };
  const previous = process.env.APP_URL;
  process.env.APP_URL = "https://preview.example.test/";
  const keyboard = summaryKeyboard("week", "2026-11-16", old);
  assert.equal(keyboard?.inline_keyboard[0][0].text, "Применить");
  const button = keyboard?.inline_keyboard[1][0];
  assert.equal(button?.text, "Открыть сводку");
  assert.equal(button && "web_app" in button ? button.web_app?.url : null, "https://preview.example.test/summary?period=week&start=2026-11-16");
  if (previous === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = previous;
});

test("все три текстовые сводки приходят с inline web_app, без изменения текста", async (t) => {
  const previousUrl = process.env.APP_URL;
  const previousToken = process.env.TELEGRAM_BOT_TOKEN;
  t.after(() => {
    mock.restoreAll();
    resetBotForTests();
    releaseCommandDb();
    if (previousUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previousUrl;
    if (previousToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = previousToken;
  });
  const { db } = await createCommandDb();
  const telegramId = newTelegramId();
  await ownerOf(db, telegramId);
  process.env.TELEGRAM_BOT_TOKEN = "123456:summary-test";
  process.env.APP_URL = "https://preview.example.test/";
  resetBotForTests();
  const sent: { text: string; markup?: { inline_keyboard: { web_app?: { url: string } }[][] } }[] = [];
  mock.method(getBot().api, "sendMessage", async (_id: unknown, text: string, options: { reply_markup?: { inline_keyboard: { web_app?: { url: string } }[][] } }) => {
    sent.push({ text, markup: options.reply_markup });
    return {} as never;
  });
  await withTelegramUser(telegramId, () => sendDailySummary(new Date("2026-11-23T12:00:00Z"), "UTC"));
  await withTelegramUser(telegramId, () => sendWeeklySummary(new Date("2026-11-22T12:00:00Z"), "UTC"));
  await withTelegramUser(telegramId, () => sendMonthlySummary(new Date("2026-11-30T12:00:00Z"), "UTC"));
  assert.equal(sent.length, 3);
  for (const [index, period] of ["day", "week", "month"].entries()) {
    const url = sent[index].markup?.inline_keyboard.flat().find((button) => button.web_app)?.web_app?.url;
    assert.equal(new URL(url!).searchParams.get("period"), period);
  }
  assert.match(sent[0].text, /Вот твоя сводка за сегодня/);
  assert.match(sent[1].text, /Вот как прошла неделя/);
  assert.match(sent[2].text, /Вот как прошёл месяц/);
});

test("API отчёта: только действительная подпись, свой профиль и корректная дата", async (t) => {
  const previousToken = process.env.TELEGRAM_BOT_TOKEN;
  t.after(() => {
    releaseCommandDb();
    if (previousToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = previousToken;
  });
  const { db } = await createCommandDb();
  const own = newTelegramId(), other = newTelegramId();
  const a = await ownerOf(db, own), b = await ownerOf(db, other);
  await db.update(schema.ownerSettings).set({ timezone: "UTC", enabledModules: ["nutrition"] }).where(eq(schema.ownerSettings.id, a.id));
  await db.insert(schema.nutritionEntries).values([
    { ownerId: a.id, name: "Своя еда", portionLabel: "1", calories: "350", proteinGrams: "10", fatGrams: "2", carbsGrams: "50", occurredAt: new Date("2026-11-16T12:00:00Z") },
    { ownerId: b.id, name: "Чужая еда", portionLabel: "1", calories: "999", proteinGrams: "10", fatGrams: "2", carbsGrams: "50", occurredAt: new Date("2026-11-16T12:00:00Z") },
  ]);
  process.env.TELEGRAM_BOT_TOKEN = "123456:summary-test";
  const sign = (id: string, age = 0) => {
    const fields = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000) - age), user: JSON.stringify({ id: Number(id), first_name: "Tester" }) });
    const check = [...fields].sort(([x], [y]) => x.localeCompare(y)).map(([key, value]) => `${key}=${value}`).join("\n");
    const secret = createHmac("sha256", "WebAppData").update(process.env.TELEGRAM_BOT_TOKEN!).digest();
    fields.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
    return fields.toString();
  };
  const { GET, POST } = await import("../src/app/api/summary/route");
  const request = (auth?: string, start = "2026-11-16") => new Request(`http://localhost/api/summary?period=week&start=${start}`, { headers: auth ? { authorization: `tma ${auth}` } : {} });
  assert.equal((await GET(request())).status, 401);
  assert.equal((await GET(request(sign(own, 90_000)))).status, 401);
  assert.equal((await GET(request(sign(own), "2026-11-17"))).status, 400);
  const response = await GET(request(sign(own)));
  assert.equal(response.status, 200);
  const data = await response.json() as { report: { nutrition?: { total: { calories: number } } }; adviceError: string | null };
  assert.equal(data.report.nutrition?.total.calories, 350);
  assert.equal(data.adviceError, null, "цифры приходят без ожидания провайдера");
  const adviceResponse = await POST(request(sign(own)));
  assert.equal(adviceResponse.status, 200);
  assert.ok((await adviceResponse.json() as { adviceError: string }).adviceError);
  assert.ok(!JSON.stringify(data).includes('"calories":999'), "чужие записи не входят в отчёт");
  assert.ok(!JSON.stringify(data).includes(other));
});
