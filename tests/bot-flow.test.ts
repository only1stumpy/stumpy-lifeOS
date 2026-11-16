import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { and, eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { createCommandDb, releaseCommandDb, newTelegramId, ownerOf, snapshotOf, type CommandDb } from "./helpers/command-db";
import { createBotHarness, foodAndExpenseReply } from "./helpers/bot-harness";

// The real bot on PGlite. Only Telegram's Bot API and the AI provider are replaced.
// Hooks live inside a suite: with --test-isolation=none top-level hooks would run once for the whole process.
describe('бот: главный путь на PGlite', () => {
let db: CommandDb;
let harness: Awaited<ReturnType<typeof createBotHarness>>;

before(async () => {
  ({ db } = await createCommandDb());
  harness = await createBotHarness();
});
after(async () => { await harness.close(); releaseCommandDb(); });

const draftsOf = (ownerId: string) => db.select().from(schema.captureDrafts).where(eq(schema.captureDrafts.ownerId, ownerId));
const keyboardLabels = (payload: Record<string, unknown>) =>
  ((payload.reply_markup as { inline_keyboard?: { text: string; callback_data: string }[][] } | undefined)?.inline_keyboard ?? []).flat();

async function captureTwoDrafts(tg: string) {
  harness.answerAiWith(foodAndExpenseReply());
  harness.clearCalls();
  await harness.deliver(tg, harness.messageUpdate(tg, "съел удон за 85 рублей"));
  const owner = await ownerOf(db, tg);
  const drafts = await draftsOf(owner.id);
  const food = drafts.find((draft) => draft.kind === "nutrition")!;
  const money = drafts.find((draft) => draft.kind === "finance")!;
  return { owner, drafts, food, money };
}

test("еда и расход из одного сообщения — два отдельных черновика, каждый с тремя кнопками", async () => {
  const tg = newTelegramId();
  await harness.onboard(tg);
  const { owner, drafts, food, money } = await captureTwoDrafts(tg);

  assert.equal(drafts.length, 2);
  assert.ok(food && money, "один черновик еды и один расхода");
  assert.equal((await db.select().from(schema.nutritionEntries).where(eq(schema.nutritionEntries.ownerId, owner.id))).length, 0, "до «Записать» еда не записана");
  assert.equal((await db.select().from(schema.financeEntries).where(eq(schema.financeEntries.ownerId, owner.id))).length, 0, "до «Записать» расход не записан");

  const draftMessages = harness.callsTo("sendMessage").filter((call) => String(call.payload.text).startsWith("Проверь, пожалуйста"));
  assert.equal(draftMessages.length, 2);
  for (const message of draftMessages) {
    assert.deepEqual(keyboardLabels(message.payload).map((button) => button.text), ["Записать", "Исправить", "Отменить"]);
  }
  const [foodText, moneyText] = draftMessages.map((call) => String(call.payload.text));
  assert.match(foodText!, /Еда: Удон/);
  assert.doesNotMatch(foodText!, /Расход/);
  assert.match(moneyText!, /Расход: Удон · 85,00 руб\. ПМР/);
  assert.doesNotMatch(moneyText!, /КБЖУ/);
  assert.equal(harness.aiAnalysisCalls().length, 1);
});

test("«Записать» подтверждает только свой черновик, «Отменить» не пишет ничего", async () => {
  const tg = newTelegramId();
  await harness.onboard(tg);
  const { owner, food, money } = await captureTwoDrafts(tg);

  harness.clearCalls();
  await harness.deliver(tg, harness.callbackUpdate(tg, `confirm:${food.id}`));
  const nutrition = await db.select().from(schema.nutritionEntries).where(eq(schema.nutritionEntries.ownerId, owner.id));
  assert.equal(nutrition.length, 1);
  assert.equal(nutrition[0]?.name, "Удон");
  assert.equal((await db.select().from(schema.financeEntries).where(eq(schema.financeEntries.ownerId, owner.id))).length, 0, "расход ждёт своего подтверждения");
  assert.match(String(harness.callsTo("answerCallbackQuery")[0]?.payload.text), /Удон · 1 порция записано/);

  await harness.deliver(tg, harness.callbackUpdate(tg, `cancel:${money.id}`));
  const [cancelled] = await db.select().from(schema.captureDrafts).where(eq(schema.captureDrafts.id, money.id));
  assert.equal(cancelled?.status, "cancelled");
  assert.equal((await db.select().from(schema.financeEntries).where(eq(schema.financeEntries.ownerId, owner.id))).length, 0);
  assert.match(String(harness.callsTo("editMessageText").at(-1)?.payload.text), /отменён\. Ничего не записывал/);
});

test("подтверждение расхода пишет операцию на счёт и не повторяется при втором нажатии", async () => {
  const tg = newTelegramId();
  await harness.onboard(tg);
  const { owner, money } = await captureTwoDrafts(tg);

  await harness.deliver(tg, harness.callbackUpdate(tg, `confirm:${money.id}`));
  const [entry] = await db.select().from(schema.financeEntries).where(eq(schema.financeEntries.ownerId, owner.id));
  assert.equal(Number(entry?.amount), 85);
  assert.equal(entry?.currency, "PRB");
  assert.equal(entry?.entryType, "expense");

  harness.clearCalls();
  await harness.deliver(tg, harness.callbackUpdate(tg, `confirm:${money.id}`));
  assert.equal((await db.select().from(schema.financeEntries).where(eq(schema.financeEntries.ownerId, owner.id))).length, 1, "повторное нажатие не создаёт вторую операцию");
  assert.ok(harness.callsTo("answerCallbackQuery").length >= 1, "пользователь получил ответ на нажатие");
});

test("«Исправить» → следующее сообщение заменяет черновик, старый отменён, новый подтверждается", async () => {
  const tg = newTelegramId();
  await harness.onboard(tg);
  const { owner, food } = await captureTwoDrafts(tg);

  await harness.deliver(tg, harness.callbackUpdate(tg, `edit:${food.id}`));
  assert.equal((await ownerOf(db, tg)).editingCaptureId, food.id);

  // The corrected answer replaces the food only; the AI sees the previous draft.
  harness.answerAiWith(() => foodAndExpenseReply({ calories: 840 }));
  await harness.deliver(tg, harness.messageUpdate(tg, "порция двойная"));
  const analysisRequest = harness.aiAnalysisCalls().at(-1)?.body ?? "";
  assert.match(analysisRequest, /previousDraft/);
  assert.match(analysisRequest, /порция двойная/);

  const [old] = await db.select().from(schema.captureDrafts).where(eq(schema.captureDrafts.id, food.id));
  assert.equal(old?.status, "cancelled");
  assert.equal((await ownerOf(db, tg)).editingCaptureId, null, "режим правки закрыт");
  const pending = (await draftsOf(owner.id)).filter((draft) => draft.status === "pending" && draft.kind === "nutrition" && draft.id !== food.id);
  assert.equal(pending.length, 1);
  await harness.deliver(tg, harness.callbackUpdate(tg, `confirm:${pending[0]!.id}`));
  const [saved] = await db.select().from(schema.nutritionEntries).where(and(eq(schema.nutritionEntries.ownerId, owner.id), eq(schema.nutritionEntries.captureDraftId, pending[0]!.id)));
  assert.equal(Number(saved?.calories), 840);
});

test("ошибка ИИ не оставляет черновиков: пользователь получает объяснение, а не молчание", async () => {
  const tg = newTelegramId();
  await harness.onboard(tg);
  harness.answerAiWith({ status: 503, body: "{}" });
  harness.clearCalls();
  await harness.deliver(tg, harness.messageUpdate(tg, "съел суп"));
  const owner = await ownerOf(db, tg);
  assert.equal((await draftsOf(owner.id)).length, 0);
  assert.ok(harness.sentTexts().some((text) => /ИИ|провайдер/i.test(text) && !text.startsWith("Разбираю")), "ответ об ошибке ИИ");
});

test("без подключённого ИИ бот честно говорит, что ИИ не настроен, а вес записывается без ИИ", async () => {
  const tg = newTelegramId();
  await harness.onboard(tg, { withAi: false });
  harness.clearCalls();
  await harness.deliver(tg, harness.messageUpdate(tg, "съел суп"));
  assert.ok(harness.sentTexts().some((text) => /ИИ пока не настроен/.test(text)));
  assert.equal((await draftsOf((await ownerOf(db, tg)).id)).length, 0);

  harness.clearCalls();
  await harness.deliver(tg, harness.messageUpdate(tg, "вес 72,4"));
  const weights = await db.select().from(schema.weightEntries).where(eq(schema.weightEntries.ownerId, (await ownerOf(db, tg)).id));
  assert.equal(weights.length, 1);
  assert.equal(Number(weights[0]?.weightKg), 72.4);
  assert.ok(harness.sentTexts().some((text) => /Записал вес 72,4 кг/.test(text)));
});

test("без принятой политики бот ничего не разбирает и не вызывает ИИ", async () => {
  const tg = newTelegramId();
  await snapshotOf(tg); // creates the owner without granting consent
  harness.answerAiWith(foodAndExpenseReply());
  const before = harness.aiAnalysisCalls().length;
  harness.clearCalls();
  await harness.deliver(tg, harness.messageUpdate(tg, "съел удон за 85 рублей"));
  assert.equal(harness.aiAnalysisCalls().length, before);
  assert.equal((await draftsOf((await ownerOf(db, tg)).id)).length, 0);
  const [notice] = harness.callsTo("sendMessage");
  assert.match(String(notice?.payload.text), /политик/i);
  assert.ok(keyboardLabels(notice!.payload).some((button) => button.callback_data === "privacy:accept"));
});

test("чужой Telegram ID не может подтвердить чужой черновик", async () => {
  const tg = newTelegramId();
  const stranger = newTelegramId();
  await harness.onboard(tg);
  await harness.onboard(stranger, { withAi: false });
  const { owner, money } = await captureTwoDrafts(tg);

  await harness.deliver(stranger, harness.callbackUpdate(stranger, `confirm:${money.id}`));
  assert.equal((await db.select().from(schema.financeEntries).where(eq(schema.financeEntries.ownerId, owner.id))).length, 0);
  const [still] = await db.select().from(schema.captureDrafts).where(eq(schema.captureDrafts.id, money.id));
  assert.equal(still?.status, "pending");
});
});
