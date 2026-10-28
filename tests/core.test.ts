import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { commandSchema } from "../src/domain/commands";
import { convertToLocalMinor, parseMinor } from "../src/domain/math";
import { suggestTargets } from "../src/domain/nutrition";
import { shouldSuggestLoadIncrease } from "../src/domain/progression";
import { advanceRecurrenceDate } from "../src/domain/recurrence";
import { analyzeMessage } from "../src/server/ai/analyze";
import { buildNutritionHistoryDays, missingMoneyCategoryMessage } from "../src/server/lifeos";
import { verifyTelegramInitData } from "../src/server/telegram/auth";

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
  assert.throws(() => parseMinor("-1"));
  assert.throws(() => parseMinor("1.001"));
  assert.throws(() => parseMinor("1e3"));
});

test("USD конвертируется с округлением к ближайшей minor unit и требует ручной курс", () => {
  assert.equal(convertToLocalMinor(100, "USD", "37.125"), 3_713);
  assert.equal(convertToLocalMinor(1, "USD", "1.5"), 2);
  assert.equal(convertToLocalMinor(1_234, "PRB", null), 1_234);
  assert.throws(() => convertToLocalMinor(100, "USD", null), /ручной курс/);
  assert.throws(() => convertToLocalMinor(100, "USD", "0"), /ручной курс/);
});

test("новый курс не переоценивает операции с сохранённым курсом каждой операции", () => {
  const entries = [
    { amountMinor: 1_000, savedRate: "35.25" },
    { amountMinor: 250, savedRate: "38" },
  ];
  const laterManualRate = "40";
  const totalAtSavedRates = entries.reduce(
    (total, entry) => total + convertToLocalMinor(entry.amountMinor, "USD", entry.savedRate),
    0,
  );

  assert.equal(totalAtSavedRates, 44_750);
  assert.notEqual(totalAtSavedRates, entries.reduce(
    (total, entry) => total + convertToLocalMinor(entry.amountMinor, "USD", laterManualRate),
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
  assert.equal(missingMoneyCategoryMessage("income"), "Уточните категорию дохода через «Исправить».");
  assert.equal(missingMoneyCategoryMessage("expense"), "Уточните категорию расхода через «Исправить».");
});

test("предложенная цель КБЖУ даёт редактируемые числовые значения и отклоняет неподходящие параметры", () => {
  const target = suggestTargets({ age: 30, heightCm: 180, weightKg: 80, sex: "male", activityMultiplier: 1.5 });

  assert.deepEqual(target, {
    calories: 2_950,
    proteinGrams: 128,
    fatGrams: 64,
    carbsGrams: 466,
  });
  assert.equal(typeof target.calories, "number");
  const editedTarget = { ...target, calories: target.calories + 100 };
  const settings = commandSchema.parse({ type: "settings.save", timeZone: "Europe/Chisinau", target: editedTarget });
  assert.deepEqual(settings.type === "settings.save" ? settings.target : null, editedTarget);
  assert.throws(() => suggestTargets({ age: 18, heightCm: 180, weightKg: 80, sex: "male", activityMultiplier: 1.5 }));
  assert.throws(() => suggestTargets({ age: 30, heightCm: 180, weightKg: 29, sex: "male", activityMultiplier: 1.5 }));
  assert.throws(() => suggestTargets({ age: 30, heightCm: 180, weightKg: 80, sex: "male", activityMultiplier: 2 }));
});
