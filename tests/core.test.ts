import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { commandSchema } from "../src/domain/commands";
import { currencyUnit, formatMoneyPlain, normalizeCurrencyCode } from "../src/domain/currencies";
import { convertToBaseMinor, formatMoneyAmount, parseMinor } from "../src/domain/math";
import { ageOn, birthDateForAge, suggestTargets, targetFromAverage, weeklyAverageWeight } from "../src/domain/nutrition";
import { parseWeightMessage } from "../src/domain/weight-message";
import { disabledFeatureMessage, disabledModulesMessage, filterEntriesByModules, normalizeDisabledFeatures, normalizeModules, resolveFeatures, type LifeFeature, type LifeModule } from "../src/domain/modules";
import { compareVersions, releasesSince, versionStageLabel } from "../src/domain/release";
import { getAiProviderDefinition, listAiProviderDefinitions } from "../src/server/ai/provider-catalog";
import { buildHelpSection, buildStartMessage, helpSections, isHelpSectionId, type HelpSectionId } from "../src/domain/welcome";
import { parseDebtMessage } from "../src/domain/debt-message";
import { parseFinancePlanMessage } from "../src/domain/finance-plans";
import { shouldSuggestLoadIncrease } from "../src/domain/progression";
import { advanceRecurrenceDate } from "../src/domain/recurrence";
import { analyzeMessage } from "../src/server/ai/analyze";
import { buildNutritionHistoryDays, missingMoneyCategoryMessage } from "../src/server/lifeos";
import { verifyTelegramInitData } from "../src/server/telegram/auth";
import { currentTelegramUserId, resolveTelegramUserId, withTelegramUser } from "../src/server/owner-context";

const botToken = "test-bot-token";
const now = 1_800_000_000;
const ownerId = "123456789";
const user = { id: Number(ownerId), first_name: "Test" };

function signedInitData(fields: [string, string][]) {
  const dataCheckString = [...fields]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  const params = new URLSearchParams();
  for (const [key, value] of fields) params.append(key, value);
  params.append("hash", hash);
  return params.toString();
}

function validInitData(overrides: { authDate?: number; userValue?: string } = {}) {
  return signedInitData([
    ["auth_date", String(overrides.authDate ?? now)],
    ["query_id", "AAE-test"],
    ["user", overrides.userValue ?? JSON.stringify(user)],
  ]);
}

const authOptions = { botToken, ownerId, now, maxAgeSeconds: 900 };

test("Telegram initData принимает корректную подпись владельца", () => {
  const result = verifyTelegramInitData(validInitData(), authOptions);

  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.user, user);
});

test("Telegram initData отвергает изменение подписанного поля", () => {
  const params = new URLSearchParams(validInitData());
  params.set("query_id", "changed");

  assert.deepEqual(verifyTelegramInitData(params.toString(), authOptions), {
    ok: false,
    reason: "invalid_signature",
  });
});

test("Telegram initData отвергает дублирующиеся ключи до проверки подписи", () => {
  const params = new URLSearchParams([
    ["auth_date", String(now)],
    ["auth_date", String(now)],
    ["user", JSON.stringify(user)],
    ["hash", "0".repeat(64)],
  ]);

  assert.deepEqual(verifyTelegramInitData(params.toString(), authOptions), {
    ok: false,
    reason: "duplicate_field",
  });
});

test("Telegram initData отклоняет просроченную и будущую авторизацию", () => {
  const expired = verifyTelegramInitData(validInitData({ authDate: now - 901 }), authOptions);
  const future = verifyTelegramInitData(validInitData({ authDate: now + 1 }), authOptions);

  assert.deepEqual(expired, { ok: false, reason: "auth_data_expired" });
  assert.deepEqual(future, { ok: false, reason: "auth_date_in_future" });
});

test("Telegram initData не авторизует пользователя с чужим Telegram ID", () => {
  const signedForAnotherUser = signedInitData([
    ["auth_date", String(now)],
    ["user", JSON.stringify({ id: 987654321, first_name: "Other" })],
  ]);

  assert.deepEqual(verifyTelegramInitData(signedForAnotherUser, authOptions), {
    ok: false,
    reason: "not_owner",
  });
});

test("Telegram initData принимает любого пользователя при включённом многопользовательском режиме", () => {
  const signedForAnotherUser = signedInitData([
    ["auth_date", String(now)],
    ["user", JSON.stringify({ id: 987654321, first_name: "Other" })],
  ]);

  const result = verifyTelegramInitData(signedForAnotherUser, { botToken, now, maxAgeSeconds: 900 });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.user.id, 987654321);
});

test("Telegram user scope stays isolated across overlapping async work", async () => {
  const [first, second] = await Promise.all([
    withTelegramUser("111", async () => {
      await new Promise((resolve) => setTimeout(resolve, 3));
      return currentTelegramUserId();
    }),
    withTelegramUser("222", async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return resolveTelegramUserId();
    }),
  ]);

  assert.equal(first, "111");
  assert.equal(second, "222");
});

test("Telegram initData отвергает повреждённый запрос, JSON, структуру и отсутствие user", () => {
  const malformedQuery = verifyTelegramInitData(
    `auth_date=${now}&user=%E0%A4%A&hash=${"0".repeat(64)}`,
    authOptions,
  );
  const malformedUserJson = verifyTelegramInitData(validInitData({ userValue: "{broken" }), authOptions);
  const malformedUserShape = verifyTelegramInitData(
    validInitData({ userValue: JSON.stringify({ id: ownerId, first_name: "Test" }) }),
    authOptions,
  );
  const missingUser = verifyTelegramInitData(
    signedInitData([["auth_date", String(now)]]),
    authOptions,
  );

  assert.deepEqual(malformedQuery, { ok: false, reason: "malformed_query" });
  assert.deepEqual(malformedUserJson, { ok: false, reason: "invalid_user" });
  assert.deepEqual(malformedUserShape, { ok: false, reason: "invalid_user" });
  assert.deepEqual(missingUser, { ok: false, reason: "missing_user" });
});

test("денежный ввод переводит десятичную сумму в minor units без ошибок float", () => {
  assert.equal(parseMinor(" 80 "), 8_000);
  assert.equal(parseMinor("12,3"), 1_230);
  assert.equal(parseMinor("0.01"), 1);
  // Spaces between groups, also the non-breaking ones the app prints: «5 913,34» must read back as typed.
  assert.equal(parseMinor("5\u00a0913,34"), 591_334);
  assert.equal(parseMinor("20 000"), 2_000_000);
  assert.equal(parseMinor("20000"), 2_000_000);
  assert.throws(() => parseMinor("1,234"), /числом/);
  assert.throws(() => parseMinor("-1"));
  assert.throws(() => parseMinor("1.001"));
  assert.throws(() => parseMinor("1e3"));
});

test("валюта конвертируется в основную с округлением и требует ручной курс", () => {
  assert.equal(convertToBaseMinor(100, "USD", "PRB", "37.125"), 3_713);
  assert.equal(convertToBaseMinor(1, "USD", "PRB", "1.5"), 2);
  assert.equal(convertToBaseMinor(1_234, "PRB", "PRB", null), 1_234);
  assert.throws(() => convertToBaseMinor(100, "USD", "PRB", null), /ручной курс/);
  assert.throws(() => convertToBaseMinor(100, "USD", "PRB", "0"), /ручной курс/);
});

test("новый курс не переоценивает операции с сохранённым курсом каждой операции", () => {
  const entries = [
    { amountMinor: 1_000, savedRate: "35.25" },
    { amountMinor: 250, savedRate: "38" },
  ];
  const laterManualRate = "40";
  const totalAtSavedRates = entries.reduce(
    (total, entry) => total + convertToBaseMinor(entry.amountMinor, "USD", "PRB", entry.savedRate),
    0,
  );

  assert.equal(totalAtSavedRates, 44_750);
  assert.notEqual(totalAtSavedRates, entries.reduce(
    (total, entry) => total + convertToBaseMinor(entry.amountMinor, "USD", "PRB", laterManualRate),
    0,
  ));
});

test("ежемесячное повторение сохраняет 31-е число после короткого февраля", () => {
  const february = advanceRecurrenceDate("2026-01-31", "month", 1, 31, 1);
  const march = advanceRecurrenceDate(february, "month", 1, 31, 1);

  assert.equal(february, "2026-02-28");
  assert.equal(march, "2026-03-31");
});

test("ежегодное повторение сохраняет 29 февраля до следующего високосного года", () => {
  const nextYear = advanceRecurrenceDate("2024-02-29", "year", 1, 29, 2);
  const followingYear = advanceRecurrenceDate(nextYear, "year", 1, 29, 2);
  const leapYear = advanceRecurrenceDate("2027-02-28", "year", 1, 29, 2);

  assert.equal(nextYear, "2025-02-28");
  assert.equal(followingYear, "2026-02-28");
  assert.equal(leapYear, "2028-02-29");
});

test("история КБЖУ хранит все даты с едой, суммирует их по часовому поясу и добавляет пустой текущий день", () => {
  const days = buildNutritionHistoryDays([
    { occurredAt: "2026-10-27T20:30:00.000Z", macros: { calories: 0, proteinGrams: 0, fatGrams: 0, carbsGrams: 0 } },
    { occurredAt: "2026-10-27T22:30:00.000Z", macros: { calories: 320, proteinGrams: 12, fatGrams: 4, carbsGrams: 60 } },
    { occurredAt: "2026-10-28T09:00:00.000Z", macros: { calories: 180, proteinGrams: 8, fatGrams: 6, carbsGrams: 25 } },
  ], "Europe/Chisinau", "2026-10-29");

  assert.deepEqual(days, [
    { date: "2026-10-27", entryCount: 1, calories: 0, proteinGrams: 0, fatGrams: 0, carbsGrams: 0 },
    { date: "2026-10-28", entryCount: 2, calories: 500, proteinGrams: 20, fatGrams: 10, carbsGrams: 85 },
    { date: "2026-10-29", entryCount: 0, calories: 0, proteinGrams: 0, fatGrams: 0, carbsGrams: 0 },
  ]);
});

test("повторения с интервалом больше единицы считают недели и месяцы от якоря", () => {
  assert.equal(advanceRecurrenceDate("2026-10-27", "week", 3), "2026-11-17");
  assert.equal(advanceRecurrenceDate("2026-01-31", "month", 2, 31, 1), "2026-03-31");
});

test("повторение отклоняет некорректную дату, якорь и интервал", () => {
  assert.throws(() => advanceRecurrenceDate("2026-02-29", "month", 1, 31, 2));
  assert.throws(() => advanceRecurrenceDate("2026-01-31", "month", 1, 32, 1));
  assert.throws(() => advanceRecurrenceDate("2026-01-31", "year", 1, 31, 13));
  assert.throws(() => advanceRecurrenceDate("2026-01-31", "month", 0, 31, 1));
});

test("повышение нагрузки предлагается только после всех плановых повторений", () => {
  const sets = [{ weightKg: "40.00", repetitions: 10 }, { weightKg: "40.00", repetitions: 10 }, { weightKg: "40.00", repetitions: 10 }];
  assert.equal(shouldSuggestLoadIncrease(sets, 3, 10), true);
  assert.equal(shouldSuggestLoadIncrease([...sets.slice(0, 2), { weightKg: "40.00", repetitions: 9 }], 3, 10), false);
  assert.equal(shouldSuggestLoadIncrease([{ weightKg: null, repetitions: 12 }], 1, 10), false);
});

test("ИИ пробует выбранные бесплатные модели Gemini и Groq по умолчанию", async () => {
  const keys = ["GEMINI_API_KEY", "GEMINI_MODEL", "GROQ_API_KEY", "GROQ_MODEL"] as const;
  const oldEnvironment = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const oldFetch = globalThis.fetch;
  const calls: { url: string; init?: RequestInit }[] = [];
  for (const key of keys) delete process.env[key];
  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.GROQ_API_KEY = "test-groq-key";
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes("generativelanguage.googleapis.com")) return new Response("unavailable", { status: 503 });
    const analysis = { entries: [{ food: { label: "Гречка", portionLabel: "тарелка", calories: 320, proteinGrams: 12, fatGrams: 4, carbsGrams: 60, estimated: true }, money: null, occurredAt: "2026-10-27T16:00:00.000Z" }], clarification: null };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(analysis) } }] }), { status: 200 });
  };

  try {
    const result = await analyzeMessage({
      text: "доход",
      clarificationHistory: [
        { role: "user", text: "у меня на счету" },
        { role: "assistant", text: "Это доход или остаток по счёту?" },
      ],
      now: "2026-10-27T16:00:00.000Z",
      timeZone: "Europe/Chisinau",
    });
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.url.includes("/models/gemini-3.5-flash-lite:"), true);
    assert.equal(JSON.parse(String(calls[1]?.init?.body)).model, "qwen/qwen3.8-27b");
    assert.equal(result.provider, "groq");
    assert.equal(result.model, "qwen/qwen3.8-27b");
    assert.equal(result.entries[0]?.food?.estimated, true);
    const groqRequest = JSON.parse(String(calls[1]?.init?.body)) as { messages: { role: string; content: string }[] };
    assert.match(groqRequest.messages[1]?.content ?? "", /у меня на счету/);
    assert.match(groqRequest.messages[1]?.content ?? "", /Это доход или остаток по счёту\?/);
    assert.match(groqRequest.messages[1]?.content ?? "", /"message":"доход"/);
  } finally {
    globalThis.fetch = oldFetch;
    for (const key of keys) {
      const oldValue = oldEnvironment[key];
      if (oldValue === undefined) delete process.env[key];
      else process.env[key] = oldValue;
    }
  }
});

test("ИИ разделяет блюда и общий чек на три независимых черновика", async () => {
  const keys = ["GEMINI_API_KEY", "GEMINI_MODEL", "GROQ_API_KEY", "GROQ_MODEL"] as const;
  const oldEnvironment = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const oldFetch = globalThis.fetch;
  for (const key of keys) delete process.env[key];
  process.env.GEMINI_API_KEY = "test-gemini-key";

  const analysis = {
    entries: [
      {
        food: {
          label: "Паста четыре сыра",
          portionLabel: "1 порция",
          calories: 650,
          proteinGrams: 20,
          fatGrams: 25,
          carbsGrams: 85,
          estimated: true,
        },
        money: null,
        occurredAt: "2026-10-28T12:15:00.000Z",
      },
      {
        food: {
          label: "Апельсиновый сок",
          portionLabel: "200 мл",
          calories: 90,
          proteinGrams: 1.4,
          fatGrams: 0.2,
          carbsGrams: 21,
          estimated: true,
        },
        money: null,
        occurredAt: "2026-10-28T12:15:00.000Z",
      },
      {
        food: null,
        money: {
          label: "Обед в кафе",
          amountMinor: 18_000,
          currency: "PRB",
          kind: "expense",
          category: "Кафе и рестораны",
        },
        occurredAt: "2026-10-28T12:15:00.000Z",
      },
    ],
    clarification: null,
  };
  let systemPrompt = "";
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      systemInstruction: { parts: { text: string }[] };
    };
    systemPrompt = request.systemInstruction.parts.map((part) => part.text).join("\n");
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(analysis) }] } }],
    }), { status: 200 });
  };

  try {
    const result = await analyzeMessage({
      text: "Пообедал в кафе, съел пасту четыре сыра и выпил сок, отдал 180 рублей",
      now: "2026-10-28T12:15:00.000Z",
      timeZone: "Europe/Chisinau",
    });

    assert.match(systemPrompt, /кажд.{0,60}самостоятельн.{0,40}блюд.{0,30}напит.{0,100}отдельн/isu);
    assert.match(systemPrompt, /Не склеивай разные позиции в общий label и не суммируй их КБЖУ/iu);
    assert.match(systemPrompt, /«паста четыре сыра и сок» — две записи питания/iu);
    assert.match(systemPrompt, /отдельный entry только с money для общего чека \(food=null\)/iu);
    assert.match(systemPrompt, /Не прикрепляй общий чек к какой-либо еде и не дублируй сумму/iu);
    assert.match(systemPrompt, /Самостоятельные операции или приёмы пищи из того же сообщения сохраняй отдельными entries/iu);

    assert.equal(result.entries.length, 3);
    assert.deepEqual(result.entries.map((entry) => entry.food?.label ?? null), ["Паста четыре сыра", "Апельсиновый сок", null]);
    assert.deepEqual(result.entries.map((entry) => entry.food?.calories ?? null), [650, 90, null]);
    assert.deepEqual(result.entries.slice(0, 2).map((entry) => entry.money), [null, null]);
    assert.equal(result.entries[2]?.money?.label, "Обед в кафе");
    assert.equal(result.entries[2]?.money?.amountMinor, 18_000);
    assert.equal(result.entries[2]?.food, null);
    assert.equal(result.entries.filter((entry) => entry.money !== null).length, 1);
  } finally {
    globalThis.fetch = oldFetch;
    for (const key of keys) {
      const oldValue = oldEnvironment[key];
      if (oldValue === undefined) delete process.env[key];
      else process.env[key] = oldValue;
    }
  }
});

test("ИИ выбирает категорию по сообщению, исправляет неверный вариант и использует Прочее без подсказки", async () => {
  const keys = ["GEMINI_API_KEY", "GEMINI_MODEL", "GROQ_API_KEY", "GROQ_MODEL"] as const;
  const oldEnvironment = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const oldFetch = globalThis.fetch;
  const responses = [
    { label: "Маршрутка", amountMinor: 550, currency: "PRB", kind: "expense", category: null },
    { label: "Маршрутка", amountMinor: 550, currency: "PRB", kind: "expense", category: "Еда" },
    { label: "Платёж", amountMinor: 10_000, currency: "PRB", kind: "expense", category: null },
  ];
  for (const key of keys) delete process.env[key];
  process.env.GEMINI_API_KEY = "test-gemini-key";
  let responseIndex = 0;
  globalThis.fetch = async () => {
    const money = responses[responseIndex++];
    const analysis = {
      entries: [{ food: null, money, occurredAt: "2026-10-27T16:00:00.000Z" }],
      clarification: null,
    };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(analysis) }] } }] }), { status: 200 });
  };

  try {
    const route = await analyzeMessage({
      text: "5,5р маршрутка",
      now: "2026-10-27T16:00:00.000Z",
      timeZone: "Europe/Chisinau",
      categories: ["Транспорт"],
    });
    const correctedRoute = await analyzeMessage({
      text: "5,5р маршрутка",
      now: "2026-10-27T16:00:00.000Z",
      timeZone: "Europe/Chisinau",
      categories: ["Еда", "Транспорт"],
    });
    const generic = await analyzeMessage({
      text: "100",
      now: "2026-10-27T16:00:00.000Z",
      timeZone: "Europe/Chisinau",
      categories: ["Прочее"],
    });

    assert.equal(route.entries[0]?.money?.category, "Транспорт");
    assert.equal(generic.entries[0]?.money?.category, "Прочее");
    assert.equal(correctedRoute.entries[0]?.money?.category, "Транспорт");
    assert.equal(responseIndex, 3);
  } finally {
    globalThis.fetch = oldFetch;
    for (const key of keys) {
      const oldValue = oldEnvironment[key];
      if (oldValue === undefined) delete process.env[key];
      else process.env[key] = oldValue;
    }
  }
});

test("команды отклоняют отрицательные или некорректные значения на границе ввода", () => {
  const accountId = "4a66de33-bf66-47c1-af72-44bd7a7d603d";
  const entryId = "7d7e29ee-bc05-4f80-8e77-1a2386d02ec4";
  const when = "2026-10-27T12:00:00Z";
  const validMoney = {
    type: "money.save",
    label: "Обед",
    occurredAt: when,
    amountMinor: 8_000,
    accountId,
    category: "Еда",
    kind: "expense",
  };

  assert.equal(commandSchema.parse(validMoney).type, "money.save");
  assert.equal(commandSchema.parse({ type: "money.delete", id: entryId }).type, "money.delete");
  assert.equal(commandSchema.safeParse({ ...validMoney, amountMinor: -1 }).success, false);
  assert.equal(commandSchema.safeParse({ ...validMoney, amountMinor: 0 }).success, false);
  assert.equal(commandSchema.safeParse({ type: "food.save", label: "Обед", portionLabel: "тарелка", occurredAt: when, calories: -1, proteinGrams: 20, fatGrams: 10, carbsGrams: 30 }).success, false);
  assert.equal(commandSchema.safeParse({ type: "weight.save", date: "2026-10-27", weightKg: -80 }).success, false);
  assert.equal(commandSchema.safeParse({ type: "day.save", name: "A", weekday: 7 }).success, false);
  assert.equal(commandSchema.safeParse({ type: "food.delete", id: "not-a-uuid" }).success, false);
  assert.deepEqual(commandSchema.parse({ type: "draft.money-category.set", id: entryId, category: " зарплата " }), {
    type: "draft.money-category.set",
    id: entryId,
    category: "зарплата",
  });
  assert.equal(commandSchema.safeParse({ type: "draft.money-category.set", id: "bad-id", category: "" }).success, false);
  assert.equal(missingMoneyCategoryMessage("income"), "Уточни категорию дохода через «Исправить».");
  assert.equal(missingMoneyCategoryMessage("expense"), "Уточни категорию расхода через «Исправить».");
});

test("предложенная цель КБЖУ учитывает цель и даёт редактируемые значения", () => {
  const base = { age: 30, heightCm: 180, weightKg: 80, sex: "male", activityLevel: "moderate" } as const;
  assert.deepEqual(suggestTargets({ ...base, goalType: "gain_mass" }), { calories: 3_050, proteinGrams: 128, fatGrams: 64, carbsGrams: 491 });
  assert.deepEqual(suggestTargets({ ...base, goalType: "maintain" }), { calories: 2_750, proteinGrams: 128, fatGrams: 64, carbsGrams: 416 });
  assert.deepEqual(suggestTargets({ ...base, goalType: "lose_weight" }), { calories: 2_350, proteinGrams: 160, fatGrams: 64, carbsGrams: 284 });
  const target = suggestTargets({ ...base, goalType: "gain_mass" });
  const edited = { ...target, calories: target.calories + 100 };
  const command = commandSchema.parse({ type: "profile.save", profile: { ...base, goalType: "gain_mass" }, target: edited });
  assert.deepEqual(command.type === "profile.save" ? command.target : null, edited);
  assert.throws(() => suggestTargets({ ...base, age: 15, goalType: "maintain" }));
  assert.throws(() => suggestTargets({ ...base, weightKg: 29, goalType: "maintain" }));
  assert.throws(() => commandSchema.parse({ type: "profile.save", profile: { ...base, activityLevel: "extreme", goalType: "maintain" }, target }));
});

test("возраст из анкеты хранится датой рождения и сам растёт с годами", () => {
  const birth = birthDateForAge(30, "2026-11-13");
  assert.equal(birth, "1996-11-13");
  assert.equal(ageOn(birth, "2026-11-13"), 30);
  assert.equal(ageOn(birth, "2027-11-12"), 30);
  assert.equal(ageOn(birth, "2027-11-13"), 31);
  assert.equal(birthDateForAge(20, "2028-02-29"), "2008-02-28");
});

test("вес из чата распознаётся только по слову «вес» или единице измерения", () => {
  assert.equal(parseWeightMessage("вес 60"), 60);
  assert.equal(parseWeightMessage("Вес: 72,4 кг"), 72.4);
  assert.equal(parseWeightMessage("60 килограмм"), 60);
  assert.equal(parseWeightMessage("60кг"), 60);
  assert.equal(parseWeightMessage("вешу 81.5"), 81.5);
  assert.equal(parseWeightMessage("мой вес сегодня 59,8 кг."), 59.8);
  assert.equal(parseWeightMessage("60"), null);
  assert.equal(parseWeightMessage("гречка 60 г"), null);
  assert.equal(parseWeightMessage("купил картошку 5 кг"), null);
  assert.equal(parseWeightMessage("вес 5"), null);
  assert.equal(parseWeightMessage("вес 900 кг"), null);
});

test("суммы с копейками всегда показывают два знака, целые остаются короткими", () => {
  assert.equal(formatMoneyAmount(90), "0,90");
  assert.equal(formatMoneyAmount(4050), "40,50");
  assert.equal(formatMoneyAmount(4851), "48,51");
  assert.equal(formatMoneyAmount(2700), "27");
  assert.equal(formatMoneyAmount(-3100), "31");
});

test("weekly target recalculation uses the 7-day average weight and skips unchanged targets", () => {
  const weights = [
    { date: "2026-11-01", weightKg: 90 },
    { date: "2026-11-08", weightKg: 78.4 },
    { date: "2026-11-11", weightKg: 78 },
    { date: "2026-11-14", weightKg: 77.6 },
  ];
  assert.deepEqual(weeklyAverageWeight(weights, "2026-11-14"), { weighIns: 3, averageKg: 78 });
  assert.deepEqual(weeklyAverageWeight([], "2026-11-14"), { weighIns: 0, averageKg: null });

  const profile = { sex: "male" as const, age: 30, heightCm: 180, activityLevel: "moderate" as const, goalType: "lose_weight" as const };
  const current = { calories: 2350, proteinGrams: 160, fatGrams: 64, carbsGrams: 284 };
  assert.deepEqual(targetFromAverage(profile, 78, current), { calories: 2300, proteinGrams: 156, fatGrams: 62, carbsGrams: 280 });
  assert.equal(targetFromAverage(profile, 80, current), null);
  assert.equal(targetFromAverage({ ...profile, heightCm: undefined }, 78, current), null);
});

test("notification settings command validates the summary time", () => {
  const base = { type: "notifications.save", settings: { dailySummary: false, weeklySummary: true, weightReminder: true, summaryTime: "21:15" } };
  assert.equal(commandSchema.safeParse(base).success, true);
  assert.equal(commandSchema.safeParse({ ...base, settings: { ...base.settings, summaryTime: null } }).success, true);
  assert.equal(commandSchema.safeParse({ ...base, settings: { ...base.settings, summaryTime: "25:00" } }).success, false);
  assert.equal(commandSchema.safeParse({ ...base, settings: { ...base.settings, summaryTime: "9:00" } }).success, false);
});

test("disabled modules drop AI records and explain why", () => {
  const food = { label: "Суп" };
  const money = { amountMinor: 1000 };
  const entries = [{ food, money, occurredAt: "x" }, { food, money: null, occurredAt: "y" }];
  const financeOnly = filterEntriesByModules(entries, ["finance"]);
  assert.deepEqual(financeOnly.entries, [{ food: null, money, occurredAt: "x" }]);
  assert.deepEqual(financeOnly.blocked, ["nutrition"]);
  assert.deepEqual(filterEntriesByModules(entries, ["nutrition", "finance"]).blocked, []);
  assert.deepEqual(filterEntriesByModules(entries, ["gym"]), { entries: [], blocked: ["nutrition", "finance"] });
  assert.match(disabledModulesMessage(["finance"]), /Раздел «Финансы» выключен/);
  assert.deepEqual(normalizeModules(["gym", "unknown", "nutrition"]), ["nutrition", "gym"]);
  assert.deepEqual(normalizeModules([]), ["nutrition", "finance", "gym"]);
});

test("onboarding command requires a module and a valid currency code", () => {
  const base = { type: "onboarding.complete", modules: ["finance"], usage: "weekly", profile: null, target: null, account: { currency: "EUR", openingBalanceMinor: 12_000 } };
  assert.equal(commandSchema.safeParse(base).success, true);
  assert.equal(commandSchema.safeParse({ ...base, modules: [] }).success, false);
  assert.equal(commandSchema.safeParse({ ...base, modules: ["finance", "finance"] }).success, false);
  assert.equal(commandSchema.safeParse({ ...base, account: { ...base.account, currency: "евро" } }).success, false);
  assert.equal(commandSchema.safeParse({ ...base, account: { ...base.account, currency: "us" } }).success, false);
  assert.equal(commandSchema.safeParse({ ...base, account: { ...base.account, currency: "prb" } }).success, true);
  assert.equal(commandSchema.safeParse({ ...base, account: null }).success, true);
});

test("rate.save принимает любую валюту и положительный курс до десяти знаков", () => {
  const rate = { type: "rate.save", currency: "EUR", rateToBase: "98.5" };
  assert.equal(commandSchema.safeParse(rate).success, true);
  assert.equal(commandSchema.safeParse({ ...rate, rateToBase: "0" }).success, false);
  assert.equal(commandSchema.safeParse({ ...rate, rateToBase: "1,5" }).success, false);
  assert.equal(commandSchema.safeParse({ ...rate, rateToBase: "1.123456789" }).success, true);
  assert.equal(commandSchema.safeParse({ ...rate, rateToBase: "1.12345678901" }).success, false);
  assert.equal(commandSchema.safeParse({ ...rate, currency: "E" }).success, false);
});

test("форматирование валют: известные единицы и неизвестный код как есть", () => {
  assert.equal(currencyUnit("USD"), "$");
  assert.equal(currencyUnit("PRB"), "р. ПМР");
  assert.equal(currencyUnit("XYZ"), "XYZ");
  assert.equal(normalizeCurrencyCode(" eur "), "EUR");
  assert.equal(normalizeCurrencyCode("рубль"), null);
  assert.equal(formatMoneyPlain(8_500, "PRB"), "85,00 руб. ПМР");
  assert.equal(formatMoneyPlain(1_000, "EUR"), "10,00 EUR");
});

test("конвертация между двумя не-USD валютами идёт через курс к основной", () => {
  assert.equal(convertToBaseMinor(1_000, "EUR", "MDL", "19.5"), 19_500);
  assert.equal(convertToBaseMinor(1_000, "MDL", "MDL", null), 1_000);
  assert.throws(() => convertToBaseMinor(1_000, "EUR", "MDL", null), /EUR/);
});

test("personalization.save keeps modules, features and notifications in one command", () => {
  const base = { type: "personalization.save", modules: ["finance"], disabledFeatures: [], settings: { dailySummary: true, weeklySummary: false, weightReminder: false, summaryTime: "19:30" } };
  assert.equal(commandSchema.safeParse(base).success, true);
  assert.equal(commandSchema.safeParse({ ...base, modules: [] }).success, false);
  assert.equal(commandSchema.safeParse({ ...base, settings: { ...base.settings, summaryTime: "25:00" } }).success, false);
  const withoutFeatures: Record<string, unknown> = { ...base };
  delete withoutFeatures.disabledFeatures;
  assert.equal(commandSchema.safeParse(withoutFeatures).success, false);
});

test("gym and weight management commands validate their input", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  assert.equal(commandSchema.safeParse({ type: "day.delete", id }).success, true);
  assert.equal(commandSchema.safeParse({ type: "day.delete", id: "nope" }).success, false);
  const update = { type: "exercise.update", dayId: id, dayExerciseId: id, targetSets: 4, targetRepetitions: 10, restSeconds: 120 };
  assert.equal(commandSchema.safeParse(update).success, true);
  assert.equal(commandSchema.safeParse({ ...update, targetSets: 0 }).success, false);
  assert.equal(commandSchema.safeParse({ type: "exercise.remove", dayId: id, dayExerciseId: id }).success, true);
  assert.equal(commandSchema.safeParse({ type: "weight.delete", date: "2026-11-14" }).success, true);
  assert.equal(commandSchema.safeParse({ type: "weight.delete", date: "14.11" }).success, false);
});

test("what's new lists every release missed since the last visit", () => {
  const history = [
    { version: "0.10.0", notes: ["c"] },
    { version: "0.9.0", notes: ["b"] },
    { version: "0.8.0", notes: ["a"] },
    { version: "0.7.0", notes: ["z"] },
  ];
  assert.deepEqual(releasesSince("0.7.0", history, "0.10.0").map((r) => r.version), ["0.10.0", "0.9.0", "0.8.0"]);
  assert.deepEqual(releasesSince("0.10.0", history, "0.10.0"), []);
  assert.deepEqual(releasesSince(null, history, "0.10.0").map((r) => r.version), ["0.10.0"]);
  assert.deepEqual(releasesSince("0.8.0", history, "0.9.0").map((r) => r.version), ["0.9.0"]);
  assert.equal(compareVersions("0.10.0", "0.9.0"), 1);
  assert.equal(compareVersions("1.0.0-rc.1", "0.26.2"), 1);
  assert.equal(compareVersions("1.0.0-rc.1", "1.0.0"), -1);
  assert.equal(versionStageLabel("1.0.0-rc.2"), "");
  assert.equal(versionStageLabel("0.26.2"), " · бета");
  assert.equal(versionStageLabel("1.0.0"), "");
  assert.equal(compareVersions("1.0.0", "1.0.0-rc.1"), 1);
  assert.equal(compareVersions("1.0.0-rc.2", "1.0.0-rc.10"), -1);
  assert.equal(compareVersions("1.0.0-rc.1", "1.0.0-rc.1"), 0);
});

test("features work only while their module is on and the user did not switch them off", () => {
  assert.deepEqual(resolveFeatures(["nutrition", "finance", "gym"], []), ["finance.debts", "finance.plans", "finance.subscriptions", "nutrition.weight"]);
  assert.deepEqual(resolveFeatures(["nutrition", "finance", "gym"], ["finance.debts", "nutrition.weight"]), ["finance.plans", "finance.subscriptions"]);
  assert.deepEqual(resolveFeatures(["gym"], []), []);
  assert.deepEqual(resolveFeatures(["finance"], ["finance.plans"]), ["finance.debts", "finance.subscriptions"]);
  assert.deepEqual(normalizeDisabledFeatures(["nutrition.weight", "bogus", "finance.debts"]), ["finance.debts", "nutrition.weight"]);
  assert.match(disabledFeatureMessage("finance.debts"), /Функция «Долги» выключена/);
});

test("modules.save accepts disabled features and rejects unknown or repeated ones", () => {
  const base = { type: "modules.save", modules: ["finance"] };
  assert.equal(commandSchema.safeParse(base).success, true);
  assert.equal(commandSchema.safeParse({ ...base, disabledFeatures: ["finance.debts", "nutrition.weight"] }).success, true);
  assert.equal(commandSchema.safeParse({ ...base, disabledFeatures: ["finance.debts", "finance.debts"] }).success, false);
  assert.equal(commandSchema.safeParse({ ...base, disabledFeatures: ["finance.usd"] }).success, false);
});

const allModules: LifeModule[] = ["nutrition", "finance", "gym"];
const allFeatures: LifeFeature[] = ["finance.debts", "finance.plans", "finance.subscriptions", "nutrition.weight"];
const plain = (html: string) => html.replace(/<\/?b>|<a href="[^"]*">|<\/a>/g, "");

test("/start is short, names only enabled sections and sends a newcomer to the app", () => {
  const newcomer = buildStartMessage({ modules: allModules, features: allFeatures, firstRun: true });
  assert.ok(newcomer.length < 1100, `start message is ${newcomer.length} chars`);
  for (const phrase of ["Привет! Я Stumpy’s LifeOS", "съел гречку с курицей", "кофе 45", "<b>Питание</b>", "<b>Финансы</b>", "<b>Зал</b>", "<b>Сводки</b>", "<b>С чего начать?</b>", "«Открыть LifeOS»", "/help"]) assert.ok(newcomer.includes(phrase), phrase);
  // The onboarding is explained in the app, not repeated here.
  assert.doesNotMatch(newcomer, /\n1\. |Расскажи о себе|основном счёте|Подключи бесплатный ключ/);
  assert.equal(plain(newcomer).search(/[<>&]/), -1);

  const returning = buildStartMessage({ modules: allModules, features: allFeatures, firstRun: false });
  assert.doesNotMatch(returning, /С чего начать/);
  assert.match(returning, /<b>Где приложение\?<\/b>/);

  const gymOnly = buildStartMessage({ modules: ["gym"], features: [], firstRun: true });
  assert.doesNotMatch(gymOnly, /<b>Питание<\/b>|<b>Финансы<\/b>|гречку|кофе/);
  assert.match(gymOnly, /<b>Зал<\/b>/);

  const noAi = buildStartMessage({ modules: allModules, features: allFeatures, firstRun: false, hasAi: false });
  assert.doesNotMatch(noAi, /съел гречку|кофе 45/);
  assert.match(noAi, /вручную[\s\S]*«ИИ-провайдеры»/);

  const noWeight = buildStartMessage({ modules: ["nutrition"], features: [], firstRun: false });
  assert.doesNotMatch(noWeight, /веду вес/);
});

test("/help menu lists enabled modules plus general sections, and each section is accurate and fits Telegram", () => {
  const input = { modules: allModules, features: allFeatures };
  assert.deepEqual(helpSections(input).map((section) => section.id), ["nutrition", "finance", "gym", "digest", "ai", "commands"]);
  assert.deepEqual(helpSections({ modules: ["finance"], features: [] }).map((section) => section.id), ["finance", "digest", "ai", "commands"]);

  for (const { id } of helpSections(input)) {
    const text = buildHelpSection(id, input);
    assert.ok(text && text.length < 3500, `${id}: ${text?.length}`);
    assert.equal(plain(text).search(/[<>&]/), -1, id);
    assert.ok(`help:${id}`.length <= 64);
    assert.equal(isHelpSectionId(id), true);
  }
  assert.equal(isHelpSectionId("bogus"), false);

  // The examples promised in the text are really recognized by the parsers.
  const finance = buildHelpSection("finance", input) ?? "";
  for (const text of ["я должен Ивану 500", "Иван должен мне 300", "занял 500 у Ивана", "Иван вернул мне 200"]) {
    assert.ok(finance.includes(`«${text}»`), text);
    assert.notEqual(parseDebtMessage(text), null, text);
  }
  assert.ok(finance.includes("«запиши в планы шампунь за 220р»"));
  assert.notEqual(parseFinancePlanMessage("запиши в планы шампунь за 220р"), null);
  const nutrition = buildHelpSection("nutrition", input) ?? "";
  assert.ok(nutrition.includes("«вес 72,4»"));
  assert.equal(parseWeightMessage("вес 72,4"), 72.4);
  assert.equal(parseWeightMessage("72,4 кг"), 72.4);

  // Disabled modules and features disappear from the help.
  assert.equal(buildHelpSection("gym", { modules: ["nutrition"], features: [] }), null);
  assert.equal(buildHelpSection("finance", { modules: ["nutrition"], features: [] }), null);
  const noDebts = buildHelpSection("finance", { modules: allModules, features: ["finance.plans"] }) ?? "";
  assert.doesNotMatch(noDebts, /я должен Ивану|Подписки и регулярные/);
  assert.match(noDebts, /запиши в планы/);
  assert.doesNotMatch(buildHelpSection("nutrition", { modules: allModules, features: [] }) ?? "", /вес 72,4/);
  assert.match(buildHelpSection("digest", { modules: ["nutrition"], features: [] }) ?? "", /сколько калорий мне осталось/);
  assert.doesNotMatch(buildHelpSection("digest", { modules: ["nutrition"], features: [] }) ?? "", /сколько я потратил/);
  const commands: HelpSectionId = "commands";
  assert.match(buildHelpSection(commands, input) ?? "", /«Записать»[\s\S]*\/today[\s\S]*\/cancel[\s\S]*\/help/);
});

test("retired AI provider Cerebras is not offered, but old rows still resolve", () => {
  const offered = listAiProviderDefinitions().map((provider) => provider.id);
  assert.deepEqual(offered, ["openrouter", "gemini", "groq", "cloudflare", "custom"]);
  assert.equal(getAiProviderDefinition("cerebras").id, "cerebras");
});
