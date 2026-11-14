import assert from "node:assert/strict";
import test from "node:test";

import type { AppSnapshot } from "../src/domain/app";
import { answerKnownReferenceQuestion, isReferenceQuestion, makeReferenceContext } from "../src/server/telegram/reference";

const snapshot = {
  localDate: "2026-10-28",
  settings: { timeZone: "Europe/Chisinau", baseCurrency: "PRB", rates: { USD: "17.5" }, defaultAccountId: "main", aiOnboardingCompleted: true },
  finance: {
    accounts: [
      { id: "main", name: "Зарплатная карта", currency: "PRB", balanceMinor: 74200, openingBalanceMinor: 70000, isDefault: true },
      { id: "usd", name: "Mastercard", currency: "USD", balanceMinor: 12550, openingBalanceMinor: 12000, isDefault: false },
    ],
    spentTodayMinor: 550,
    spentMonthMinor: 22000,
    entries: [],
  },
  reports: { expenseCategories: [], nutritionDays: [], exerciseProgress: [] },
  nutrition: {
    consumed: { calories: 1200, proteinGrams: 50, fatGrams: 40, carbsGrams: 130 },
    target: { calories: 2250, proteinGrams: 81, fatGrams: 40, carbsGrams: 392 },
    entries: [], bodyWeightKg: 80, weightHistory: [],
  },
  gym: { trainingDay: false, nextWorkout: null, lastWorkout: null, program: [] },
  recurring: [],
  templates: [],
} as unknown as AppSnapshot;

test("вопрос о балансе отвечает остатком основного счёта и не требует уточнения", () => {
  assert.equal(
    answerKnownReferenceQuestion("сколько у меня на балансе?", snapshot),
    "На основном счёте сейчас 742,00 руб. ПМР по записям LifeOS.",
  );
});

test("запрос счёта USD выбирает отдельный счёт", () => {
  assert.equal(
    answerKnownReferenceQuestion("Сколько на Mastercard в долларах?", snapshot),
    "На счёте «Mastercard» сейчас 125,50 USD по записям LifeOS.",
  );
});

test("справочные вопросы перехватываются, а обычное сообщение о еде остаётся записью", () => {
  assert.equal(isReferenceQuestion("сколько у меня на балансе?"), true);
  assert.equal(isReferenceQuestion("100 грамм оливье"), false);
  assert.equal(isReferenceQuestion("съел удон за 85 рублей"), false);
});

test("справочный контекст содержит агрегаты, но не включает черновики и Telegram ID", () => {
  const context = makeReferenceContext(snapshot);
  assert.match(context, /"balanceMinor":74200/);
  assert.match(context, /"spentTodayMinor":550/);
  assert.doesNotMatch(context, /"drafts"|telegramUserId|"id":"main"/);
});
