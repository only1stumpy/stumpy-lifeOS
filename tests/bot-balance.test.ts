import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { formatBalanceLines, matchAccountByName, openingBalanceFor, parseSetBalanceMessage, totalInBaseMinor, type BalanceAccount } from "../src/domain/balance";
import { createCommandDb, releaseCommandDb, newTelegramId, ownerOf, run, snapshotOf, type CommandDb } from "./helpers/command-db";
import { createBotHarness, foodAndExpenseReply } from "./helpers/bot-harness";

const account = (id: string, name: string, currency: string, balanceMinor: number, openingBalanceMinor = 0): BalanceAccount => ({ id, name, currency, balanceMinor, openingBalanceMinor });

describe("домен: остаток и «поставь баланс»", () => {
  test("итог по счетам в основной валюте идёт по сохранённому курсу; без курса итога нет", () => {
    const accounts = [account("a", "Касса", "PRB", 100_000), account("b", "Mastercard", "USD", 12_550)];
    assert.equal(totalInBaseMinor(accounts, "PRB", { USD: "17.5" }), 100_000 + 219_625);
    assert.equal(totalInBaseMinor(accounts, "PRB", {}), null);
    const lines = formatBalanceLines(accounts, ["b"], "PRB", { USD: "17.5" }).map((line) => line.replace(/[\u00a0\u202f]/g, " "));
    assert.match(lines[0], /^Остаток на «Mastercard»: 125,50 USD$/);
    assert.match(lines[1], /^Всего по счетам: 3 196,25 руб\. ПМР$/);
    assert.equal(formatBalanceLines([accounts[0]], ["a"], "PRB", {}).length, 1, "один счёт — без общего итога");
    assert.match(formatBalanceLines(accounts, ["a"], "PRB", {})[1], /не задан курс/);
  });

  test("разбор команды: счёт, сумма, суффикс «к», запятая, минус; чужие тексты не трогает", () => {
    assert.deepEqual(parseSetBalanceMessage("поставь баланс карты 5000"), { accountQuery: "карты", targetMinor: 500_000 });
    assert.deepEqual(parseSetBalanceMessage("Установи остаток на счёте Касса 1 250,50 руб."), { accountQuery: "Касса", targetMinor: 125_050 });
    assert.deepEqual(parseSetBalanceMessage("задай баланс 5к"), { accountQuery: "", targetMinor: 500_000 });
    assert.equal(parseSetBalanceMessage("поставь баланс карты -300")?.targetMinor, -30_000);
    assert.equal(parseSetBalanceMessage("какой у меня баланс"), null);
    assert.equal(parseSetBalanceMessage("поставь баланс карты"), null);
    assert.equal(parseSetBalanceMessage("купил хлеб за 50"), null);
  });

  test("счёт по имени: падежные окончания, точное имя, неоднозначность и отсутствие", () => {
    const accounts = [account("1", "Карта", "PRB", 0), account("2", "Карта USD", "USD", 0), account("3", "Касса", "PRB", 0)];
    assert.equal(matchAccountByName(accounts, "кассы").kind, "found");
    assert.equal(matchAccountByName(accounts, "Карта").kind, "found", "точное имя побеждает «Карта USD»");
    const ambiguous = matchAccountByName(accounts, "карты");
    assert.equal(ambiguous.kind, "ambiguous");
    assert.equal(matchAccountByName(accounts, "сейф").kind, "none");
    assert.equal(matchAccountByName([accounts[0]], "").kind, "found", "единственный счёт можно не называть");
    assert.equal(matchAccountByName(accounts, "").kind, "ambiguous");
  });

  test("начальный остаток пересчитывается так, чтобы записанные операции остались", () => {
    assert.equal(openingBalanceFor(500_000, { balanceMinor: 74_200, openingBalanceMinor: 70_000 }), 495_800);
  });
});

describe("бот: остаток после операций и «поставь баланс»", () => {
  let db: CommandDb;
  let harness: Awaited<ReturnType<typeof createBotHarness>>;
  before(async () => {
    ({ db } = await createCommandDb());
    harness = await createBotHarness();
  });
  after(async () => { await harness.close(); releaseCommandDb(); });

  const buttons = (payload: Record<string, unknown>) =>
    ((payload.reply_markup as { inline_keyboard?: { text: string; callback_data: string }[][] } | undefined)?.inline_keyboard ?? []).flat();
  const lastEdit = () => String(harness.callsTo("editMessageText").at(-1)?.payload.text).replace(/[\u00a0\u202f]/g, " ");
  const openingOf = async (accountId: string) => Number((await db.select().from(schema.financeAccounts).where(eq(schema.financeAccounts.id, accountId)))[0].openingBalance);

  test("после «Записать» расход бот показывает остаток счёта; при нескольких валютах — общий итог по курсу", async () => {
    const tg = newTelegramId();
    await harness.onboard(tg);
    await run(tg, { type: "account.save", name: "Mastercard", currency: "USD", openingBalanceMinor: 10_000, isDefault: false });
    await run(tg, { type: "rate.save", currency: "USD", rateToBase: "20" });
    harness.answerAiWith(foodAndExpenseReply());
    await harness.deliver(tg, harness.messageUpdate(tg, "съел удон за 85 рублей"));
    const owner = await ownerOf(db, tg);
    const money = (await db.select().from(schema.captureDrafts).where(eq(schema.captureDrafts.ownerId, owner.id))).find((draft) => draft.kind === "finance")!;
    harness.clearCalls();
    await harness.deliver(tg, harness.callbackUpdate(tg, `confirm:${money.id}`));
    const text = lastEdit();
    assert.match(text, /Остаток на «Касса»: 915,00 руб\. ПМР/);
    // 915 + 100 USD × 20 = 2 915
    assert.match(text, /Всего по счетам: 2 915,00 руб\. ПМР/);
  });

  test("«поставь баланс»: черновик с тремя кнопками, до «Записать» ничего не меняется, отмена тоже", async () => {
    const tg = newTelegramId();
    await harness.onboard(tg);
    const accountId = (await snapshotOf(tg)).finance.accounts[0].id;
    harness.clearCalls();
    await harness.deliver(tg, harness.messageUpdate(tg, "поставь баланс кассы 5000"));
    assert.equal(harness.aiAnalysisCalls().length, 0, "команда разбирается без ИИ");
    const draft = harness.callsTo("sendMessage").at(-1)!;
    assert.match(String(draft.payload.text).replace(/[\u00a0\u202f]/g, " "), /Баланс счёта «Касса»: 1 000,00 руб\. ПМР → 5 000,00 руб\. ПМР/);
    assert.deepEqual(buttons(draft.payload).map((button) => button.text), ["Записать", "Исправить", "Отменить"]);
    assert.equal(await openingOf(accountId), 1000);

    await harness.deliver(tg, harness.callbackUpdate(tg, buttons(draft.payload)[2].callback_data));
    assert.equal(await openingOf(accountId), 1000, "«Отменить» ничего не меняет");
    assert.equal((await db.select().from(schema.financeEntries)).filter((entry) => entry.accountId === accountId).length, 0);
  });

  test("«Записать» меняет начальный остаток, а не создаёт операцию; операции после черновика сохраняются; повтор идемпотентен", async () => {
    const tg = newTelegramId();
    await harness.onboard(tg);
    const accountId = (await snapshotOf(tg)).finance.accounts[0].id;
    await run(tg, { type: "money.save", label: "Хлеб", occurredAt: new Date().toISOString(), amountMinor: 20_000, accountId, category: "Еда", kind: "expense" });
    harness.clearCalls();
    await harness.deliver(tg, harness.messageUpdate(tg, "поставь баланс 5000"));
    const confirm = buttons(harness.callsTo("sendMessage").at(-1)!.payload)[0].callback_data;
    await harness.deliver(tg, harness.callbackUpdate(tg, confirm));
    assert.match(lastEdit(), /теперь 5 000,00 руб\. ПМР/);
    assert.equal((await snapshotOf(tg)).finance.accounts[0].balanceMinor, 500_000);
    assert.equal(await openingOf(accountId), 5200, "начальный остаток = цель + уже записанные расходы");
    assert.equal((await db.select().from(schema.financeEntries).where(eq(schema.financeEntries.accountId, accountId))).length, 1, "новых операций нет");

    await harness.deliver(tg, harness.callbackUpdate(tg, confirm));
    assert.equal((await snapshotOf(tg)).finance.accounts[0].balanceMinor, 500_000, "повторное нажатие не двигает баланс");
  });

  test("неоднозначное и неизвестное имя счёта: бот уточняет и ничего не пишет", async () => {
    const tg = newTelegramId();
    await harness.onboard(tg);
    await run(tg, { type: "account.save", name: "Касса запасная", currency: "PRB", openingBalanceMinor: 0, isDefault: false });
    harness.clearCalls();
    await harness.deliver(tg, harness.messageUpdate(tg, "поставь баланс кассы 100"));
    const ambiguous = harness.callsTo("sendMessage").at(-1)!;
    assert.match(String(ambiguous.payload.text), /Какой счёт имеешь в виду: «Касса», «Касса запасная»/);
    assert.equal(buttons(ambiguous.payload).length, 0);
    await harness.deliver(tg, harness.messageUpdate(tg, "поставь баланс сейфа 100"));
    assert.match(String(harness.callsTo("sendMessage").at(-1)!.payload.text), /Не нашёл счёт «сейфа»/);
    assert.deepEqual((await snapshotOf(tg)).finance.accounts.map((item) => item.openingBalanceMinor).sort(), [0, 100_000]);
  });

  test("валюта счёта сохраняется при установке баланса", async () => {
    const tg = newTelegramId();
    await harness.onboard(tg);
    await run(tg, { type: "account.save", name: "Mastercard", currency: "USD", openingBalanceMinor: 0, isDefault: false });
    harness.clearCalls();
    await harness.deliver(tg, harness.messageUpdate(tg, "поставь баланс mastercard 250"));
    await harness.deliver(tg, harness.callbackUpdate(tg, buttons(harness.callsTo("sendMessage").at(-1)!.payload)[0].callback_data));
    const usd = (await snapshotOf(tg)).finance.accounts.find((item) => item.name === "Mastercard")!;
    assert.equal(usd.currency, "USD");
    assert.equal(usd.balanceMinor, 25_000);
  });
});
