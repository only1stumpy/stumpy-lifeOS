import assert from "node:assert/strict";
import test from "node:test";

import { formatBulkSummary, formatConfirmedRecords, formatRecurringConfirmation } from "../src/server/telegram/confirmation";

const food = {
  name: "Оливье",
  portionLabel: "100 г",
  calories: "165.5",
  proteinGrams: "4.2",
  fatGrams: "12",
  carbsGrams: "8.5",
};

test("подтверждение еды называет блюдо, порцию и КБЖУ", () => {
  const result = formatConfirmedRecords({ food, money: null });

  assert.equal(result.callbackText, "Оливье · 100 г записано");
  assert.match(result.messageText, /Записал еду: Оливье · 100 г/);
  assert.match(result.messageText, /КБЖУ: 166 ккал · Б 4,2 · Ж 12 · У 8,5 г/);
});

test("подтверждение расхода называет операцию, сумму и валюту", () => {
  const result = formatConfirmedRecords({
    food: null,
    money: { name: "Маршрутка", entryType: "expense", amount: "5.5000", currency: "PRB" },
  });

  assert.equal(result.callbackText, "Расход: Маршрутка · 5,50 руб. ПМР записан");
  assert.equal(result.messageText, "Записал расход: Маршрутка · 5,50 руб. ПМР");
});

test("подтверждение дохода отличает зачисление от расхода", () => {
  const result = formatConfirmedRecords({
    food: null,
    money: { name: "Зарплата", entryType: "income", amount: "742", currency: "PRB" },
  });

  assert.equal(result.callbackText, "Доход: Зарплата · 742,00 руб. ПМР зачислен");
  assert.equal(result.messageText, "Записал доход: Зарплата · 742,00 руб. ПМР");
});

test("комбинированное подтверждение перечисляет и еду, и расход", () => {
  const result = formatConfirmedRecords({
    food,
    money: { name: "Удон", entryType: "expense", amount: "85", currency: "PRB" },
  });

  assert.match(result.callbackText, /Еда: Оливье · расход: Удон 85,00 руб\. ПМР/);
  assert.equal(result.messageText, "Записал:\nЕда — Оливье · 100 г · 166 ккал\nРасход — Удон · 85,00 руб. ПМР");
});

test("подтверждение регулярного платежа называет подписку и сумму", () => {
  const result = formatRecurringConfirmation({ name: "Spotify", amount: "10", currency: "USD" });

  assert.equal(result.callbackText, "Оплата Spotify · 10,00 USD записана");
  assert.equal(result.messageText, "Записал оплату: Spotify · 10,00 USD");
});

test("при отсутствии сохранённых строк не заявляет об успешной записи", () => {
  const result = formatConfirmedRecords({ food: null, money: null });

  assert.doesNotMatch(result.messageText, /готово|записал/i);
  assert.match(result.messageText, /не нашёл сохранённую запись/i);
});

test("текст callback остаётся в ограничении Telegram даже с длинными названиями", () => {
  const result = formatConfirmedRecords({
    food: { ...food, name: "Еда".repeat(150) },
    money: null,
  });

  assert.ok(Array.from(result.callbackText).length <= 200);
});

test("итог после «Записать все» перечисляет записанное и непроведённое", () => {
  const drafts = [
    { food: { label: "раф с сиропом", calories: 250, proteinGrams: 5, fatGrams: 12, carbsGrams: 30 }, money: null, debt: null },
    { food: null, money: { label: "раф с сиропом", amountMinor: 2900, currency: "PRB", kind: "expense" as const, category: "Кафе и рестораны" }, debt: null },
  ];
  assert.equal(
    formatBulkSummary(drafts, 3, ["нужен ручной курс"], "PRB"),
    [
      "Записано 2 из 3",
      "• Еда: раф с сиропом — 250 ккал · Б 5 · Ж 12 · У 30",
      "• Расход: раф с сиропом — 29,00 руб. ПМР · Кафе и рестораны",
      "Не записано: нужен ручной курс",
    ].join("\n"),
  );
});

test("длинный итог обрезается, остаток считается", () => {
  const many = Array.from({ length: 15 }, (_, i) => ({ food: null, money: { label: `позиция ${i}`, amountMinor: 100, currency: "USD", kind: "expense" as const, category: null }, debt: null }));
  const lines = formatBulkSummary(many, 15, [], "USD").split("\n");
  assert.equal(lines[0], "Записано 15 из 15");
  assert.equal(lines.length, 1 + 12 + 1);
  assert.equal(lines.at(-1), "…и ещё 3");
});
