import assert from "node:assert/strict";
import test from "node:test";
import { answerLifeOSQuestion } from "../src/server/ai/analyze";
import { AIAnalysisError } from "../src/server/ai/types";

const ENV_KEYS = ["GEMINI_API_KEY", "GEMINI_MODEL", "GROQ_API_KEY", "GROQ_MODEL"] as const;

async function withMockedProviders(
  keys: { gemini?: string; groq?: string },
  fetchMock: typeof fetch,
  run: () => Promise<void>,
): Promise<void> {
  const oldEnvironment = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const oldFetch = globalThis.fetch;
  for (const key of ENV_KEYS) delete process.env[key];
  if (keys.gemini) process.env.GEMINI_API_KEY = keys.gemini;
  if (keys.groq) process.env.GROQ_API_KEY = keys.groq;
  globalThis.fetch = fetchMock;

  try {
    await run();
  } finally {
    globalThis.fetch = oldFetch;
    for (const key of ENV_KEYS) {
      const oldValue = oldEnvironment[key];
      if (oldValue === undefined) delete process.env[key];
      else process.env[key] = oldValue;
    }
  }
}

function geminiResponse(text: string): Response {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
}

function groqResponse(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}

test("справочный ответ использует только чтение и переданный JSON-контекст", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  await withMockedProviders({ gemini: "test-gemini-key" }, async (input, init) => {
    calls.push({ url: String(input), init });
    return geminiResponse("На основном счёте 742 руб. ПМР.");
  }, async () => {
    const result = await answerLifeOSQuestion({
      question: "Сколько у меня на балансе?",
      context: JSON.stringify({ mainAccount: "Основной счёт", balance: "742 руб. ПМР" }),
    });

    assert.deepEqual(result, {
      answer: "На основном счёте 742 руб. ПМР.",
      provider: "gemini",
      model: "gemini-3.5-flash-lite",
    });
    assert.equal(calls.length, 1);
    const request = JSON.parse(String(calls[0]?.init?.body)) as {
      systemInstruction: { parts: { text: string }[] };
      contents: { parts: { text: string }[] }[];
      generationConfig: { maxOutputTokens: number };
    };
    assert.match(request.systemInstruction.parts[0]?.text ?? "", /ТОЛЬКО ДЛЯ ЧТЕНИЯ/);
    assert.match(request.contents[0]?.parts[0]?.text ?? "", /Сколько у меня на балансе/);
    assert.match(request.contents[0]?.parts[0]?.text ?? "", /742 руб\. ПМР/);
    assert.equal(request.generationConfig.maxOutputTokens, 400);
  });
});

test("слишком длинный ответ Gemini отклоняется, затем используется Groq", async () => {
  const calls: string[] = [];
  await withMockedProviders({ gemini: "test-gemini-key", groq: "test-groq-key" }, async (input) => {
    const url = String(input);
    calls.push(url);
    return url.includes("generativelanguage.googleapis.com")
      ? geminiResponse("а".repeat(801))
      : groqResponse("Сегодня записана одна трата — 80 руб. ПМР.");
  }, async () => {
    const result = await answerLifeOSQuestion({
      question: "Сколько я потратил сегодня?",
      context: JSON.stringify({ todayExpense: "80 руб. ПМР", count: 1 }),
    });

    assert.equal(result.provider, "groq");
    assert.equal(result.answer, "Сегодня записана одна трата — 80 руб. ПМР.");
    assert.equal(calls.length, 2);
  });
});

test("некорректный ответ и отказ провайдеров возвращают безопасную ошибку", async () => {
  let calls = 0;
  await withMockedProviders({ gemini: "test-gemini-key", groq: "test-groq-key" }, async (input) => {
    calls += 1;
    return String(input).includes("generativelanguage.googleapis.com")
      ? geminiResponse("```json\n{\"type\":\"money.save\"}\n```")
      : new Response("upstream unavailable", { status: 503 });
  }, async () => {
    await assert.rejects(
      answerLifeOSQuestion({ question: "Сколько у меня на балансе?", context: JSON.stringify({}) }),
      (error: unknown) => {
        assert.ok(error instanceof AIAnalysisError);
        assert.equal(error.code, "provider_failed");
        assert.deepEqual(error.attemptedProviders, ["gemini", "groq"]);
        assert.doesNotMatch(error.message, /upstream unavailable|money\.save/);
        return true;
      },
    );
    assert.equal(calls, 2);
  });
});

test("невалидный или превышающий лимит ввод отклоняется до сетевого вызова", async () => {
  let calls = 0;
  await withMockedProviders({ gemini: "test-gemini-key" }, async () => {
    calls += 1;
    return geminiResponse("не должен вызываться");
  }, async () => {
    const cases = [
      { question: " ", context: "{}" },
      { question: "Вопрос", context: "не JSON" },
      { question: "Вопрос".repeat(400), context: "{}" },
      { question: "Вопрос", context: JSON.stringify({ data: "x".repeat(8_000) }) },
    ];

    for (const input of cases) {
      await assert.rejects(answerLifeOSQuestion(input), (error: unknown) => {
        assert.ok(error instanceof AIAnalysisError);
        assert.equal(error.code, "invalid_input");
        return true;
      });
    }
    assert.equal(calls, 0);
  });
});
