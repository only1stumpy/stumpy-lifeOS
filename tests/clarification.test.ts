import assert from "node:assert/strict";
import test from "node:test";
import {
  activeClarificationHistory,
  appendClarificationTurn,
  nextClarificationHistory,
} from "../src/server/ai/clarification";
import { analyzeMessage } from "../src/server/ai/analyze";

const now = new Date("2026-10-28T06:00:00.000Z");

test("история clarification переживает несколько уточнений и сохраняет исходное событие", () => {
  let history = nextClarificationHistory(null, "у меня на счету 742р", "Это доход или остаток по счёту?", false);
  assert.deepEqual(history, [
    { role: "user", text: "у меня на счету 742р" },
    { role: "assistant", text: "Это доход или остаток по счёту?" },
  ]);

  history = nextClarificationHistory(history, "доход", "Укажите источник дохода.", false);
  assert.deepEqual(history, [
    { role: "user", text: "у меня на счету 742р" },
    { role: "assistant", text: "Это доход или остаток по счёту?" },
    { role: "user", text: "доход" },
    { role: "assistant", text: "Укажите источник дохода." },
  ]);
  assert.deepEqual(activeClarificationHistory(history, now, now), history);
});

test("история не подмешивается после 30 минут и отбрасывает не текстовые данные", () => {
  const history = [
    { role: "user", text: "обед за 80 рублей", image: "must not persist" },
    { role: "assistant", text: "Это расход?" },
  ];
  const sanitized = appendClarificationTurn(null, "обед за 80 рублей", "Это расход?");

  assert.deepEqual(sanitized, [
    { role: "user", text: "обед за 80 рублей" },
    { role: "assistant", text: "Это расход?" },
  ]);
  assert.deepEqual(activeClarificationHistory(history, now, now), sanitized);
  assert.equal(activeClarificationHistory(history, new Date(now.getTime() - 30 * 60_000 - 1), now), null);
  assert.equal(activeClarificationHistory(history, new Date(now.getTime() + 1), now), null);
});

test("создание черновика очищает историю, а новое уточнение её продолжает", () => {
  const history = appendClarificationTurn(null, "у меня на счету 742р", "Это доход или остаток?");

  assert.equal(nextClarificationHistory(history, "доход", null, true), null);
  assert.deepEqual(
    nextClarificationHistory(history, "доход", "Какой источник дохода?", false),
    [...history, { role: "user", text: "доход" }, { role: "assistant", text: "Какой источник дохода?" }],
  );
});

test("контекст суммы баланса детерминированно превращается в уточнение категории и финансовый черновик", async () => {
  const keys = ["GEMINI_API_KEY", "GEMINI_MODEL", "GROQ_API_KEY", "GROQ_MODEL"] as const;
  const oldEnvironment = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const oldFetch = globalThis.fetch;
  let fetchCalls = 0;
  for (const key of keys) delete process.env[key];
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("Внешний ИИ не должен вызываться для этого уточнения");
  };

  try {
    const history = nextClarificationHistory(
      null,
      "у меня на счету 742р",
      "742 рубля — это текущий баланс или доход/расход?",
      false,
    );
    const kindReply = await analyzeMessage({
      text: "доход",
      clarificationHistory: history ?? undefined,
      now: "2026-10-28T06:33:00.000Z",
      timeZone: "Europe/Chisinau",
    });

    assert.deepEqual(kindReply.entries, []);
    assert.equal(kindReply.clarification, "Подскажи, пожалуйста, категорию дохода — например, «зарплата».");
    assert.equal(kindReply.provider, "local");

    const categoryHistory = nextClarificationHistory(
      history,
      "доход",
      kindReply.clarification,
      false,
    );
    const categoryReply = await analyzeMessage({
      text: "зарплата",
      clarificationHistory: categoryHistory ?? undefined,
      now: "2026-10-28T06:34:00.000Z",
      timeZone: "Europe/Chisinau",
    });

    assert.deepEqual(categoryReply.entries, [{
      food: null,
      money: {
        label: "Зарплата",
        amountMinor: 74_200,
        currency: "PRB",
        kind: "income",
        category: "зарплата",
      },
      occurredAt: "2026-10-28T06:34:00.000Z",
    }]);
    assert.equal(categoryReply.clarification, null);
    assert.equal(categoryReply.provider, "local");

    const recoveredLegacyReply = await analyzeMessage({
      text: "зарплата",
      clarificationHistory: [
        { role: "user", text: "у меня на счету 742р" },
        { role: "assistant", text: "742 рубля — это ваш текущий баланс или доход/расход?" },
        { role: "user", text: "доход" },
        { role: "assistant", text: "Уточните сумму этого дохода и его категорию." },
        { role: "user", text: "зарплата" },
        { role: "assistant", text: "Уточните сумму зарплаты." },
      ],
      now: "2026-10-28T06:36:00.000Z",
      timeZone: "Europe/Chisinau",
    });

    assert.deepEqual(recoveredLegacyReply.entries, [{
      food: null,
      money: {
        label: "Зарплата",
        amountMinor: 74_200,
        currency: "PRB",
        kind: "income",
        category: "зарплата",
      },
      occurredAt: "2026-10-28T06:36:00.000Z",
    }]);
    assert.equal(recoveredLegacyReply.provider, "local");
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = oldFetch;
    for (const key of keys) {
      const oldValue = oldEnvironment[key];
      if (oldValue === undefined) delete process.env[key];
      else process.env[key] = oldValue;
    }
  }
});

test("неполная или посторонняя история не переносит сумму и не обходит обычный разбор", async () => {
  const keys = ["GEMINI_API_KEY", "GEMINI_MODEL", "GROQ_API_KEY", "GROQ_MODEL"] as const;
  const oldEnvironment = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const oldFetch = globalThis.fetch;
  const calls: string[] = [];
  for (const key of keys) delete process.env[key];
  process.env.GEMINI_API_KEY = "test-gemini-key";
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ entries: [], clarification: "Уточните сумму." }) }] } }],
    }), { status: 200 });
  };

  try {
    const result = await analyzeMessage({
      text: "зарплата",
      clarificationHistory: [
        { role: "user", text: "у меня на счету зарплата" },
        { role: "assistant", text: "Это баланс или доход/расход?" },
        { role: "user", text: "доход" },
        { role: "assistant", text: "Уточните категорию дохода." },
      ],
      now: "2026-10-28T06:35:00.000Z",
      timeZone: "Europe/Chisinau",
    });

    assert.deepEqual(result.entries, []);
    assert.equal(result.clarification, "Уточните сумму.");
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = oldFetch;
    for (const key of keys) {
      const oldValue = oldEnvironment[key];
      if (oldValue === undefined) delete process.env[key];
      else process.env[key] = oldValue;
    }
  }
});
