import assert from "node:assert/strict";
import test from "node:test";
import { analyzeMessage, answerLifeOSQuestion } from "../src/server/ai/analyze";
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

function analysisInput() {
  return {
    text: "съел тарелку супа",
    timeZone: "Europe/Chisinau",
    now: "2026-10-29T12:00:00+02:00",
  };
}

function referenceInput() {
  return { question: "Сколько у меня на балансе?", context: JSON.stringify({ balance: "742 руб. ПМР" }) };
}

function providerError(status: number, error: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ error }), { status });
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

test("некорректный ответ и отказ провайдеров возвращают безопасную смешанную ошибку", async () => {
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
        assert.equal(error.code, "provider_mixed");
        assert.deepEqual(error.attemptedProviders, ["gemini", "groq"]);
        assert.doesNotMatch(error.message, /upstream unavailable|money\.save/);
        return true;
      },
    );
    assert.equal(calls, 2);
  });
});

test("429 Gemini и Groq объясняются как лимит API, а не как законченные кредиты", async () => {
  await withMockedProviders({ gemini: "test-gemini-key" }, async () => providerError(429, {
    code: 429,
    status: "RESOURCE_EXHAUSTED",
    message: "UPSTREAM_PRIVATE_GEMINI_MESSAGE",
  }), async () => {
    await assert.rejects(analyzeMessage(analysisInput()), (error: unknown) => {
      assert.ok(error instanceof AIAnalysisError);
      assert.equal(error.code, "quota_exceeded");
      assert.match(error.message, /лимит запросов/i);
      assert.match(error.message, /это не обязательно означает, что закончились оплаченные кредиты/i);
      assert.doesNotMatch(error.message, /UPSTREAM_PRIVATE|test-gemini-key/i);
      return true;
    });
  });

  await withMockedProviders({ groq: "test-groq-key" }, async () => providerError(429, {
    code: "rate_limit_exceeded",
    type: "rate_limit_error",
    message: "UPSTREAM_PRIVATE_GROQ_MESSAGE",
  }), async () => {
    await assert.rejects(answerLifeOSQuestion(referenceInput()), (error: unknown) => {
      assert.ok(error instanceof AIAnalysisError);
      assert.equal(error.code, "quota_exceeded");
      assert.match(error.message, /лимит запросов/i);
      assert.match(error.message, /это не обязательно означает, что закончились оплаченные кредиты/i);
      assert.doesNotMatch(error.message, /UPSTREAM_PRIVATE|test-groq-key/i);
      return true;
    });
  });
});

test("Gemini 402 и структурированный payment_required указывают на исчерпанные кредиты", async () => {
  await withMockedProviders({ gemini: "test-gemini-key" }, async () => providerError(402, {
    code: 402,
    status: "PAYMENT_REQUIRED",
    message: "UPSTREAM_PRIVATE_BILLING_MESSAGE",
  }), async () => {
    await assert.rejects(analyzeMessage(analysisInput()), (error: unknown) => {
      assert.ok(error instanceof AIAnalysisError);
      assert.equal(error.code, "credits_exhausted");
      assert.match(error.message, /оплаченные кредиты исчерпаны/i);
      assert.doesNotMatch(error.message, /UPSTREAM_PRIVATE|test-gemini-key/i);
      return true;
    });
  });

  await withMockedProviders({ groq: "test-groq-key" }, async () => providerError(400, {
    code: "payment_required",
    message: "UPSTREAM_PRIVATE_BILLING_MESSAGE",
  }), async () => {
    await assert.rejects(answerLifeOSQuestion(referenceInput()), (error: unknown) => {
      assert.ok(error instanceof AIAnalysisError);
      assert.equal(error.code, "credits_exhausted");
      assert.match(error.message, /оплаченные кредиты исчерпаны/i);
      assert.doesNotMatch(error.message, /UPSTREAM_PRIVATE|test-groq-key/i);
      return true;
    });
  });
});

test("сетевой сбой и HTTP 5xx показываются как временная недоступность API", async () => {
  await withMockedProviders({ gemini: "test-gemini-key" }, async () => {
    throw new Error("PRIVATE_NETWORK_EXCEPTION");
  }, async () => {
    await assert.rejects(analyzeMessage(analysisInput()), (error: unknown) => {
      assert.ok(error instanceof AIAnalysisError);
      assert.equal(error.code, "provider_unavailable");
      assert.match(error.message, /API сейчас не отвечает|временно недоступен/i);
      assert.doesNotMatch(error.message, /PRIVATE_NETWORK_EXCEPTION|test-gemini-key/i);
      return true;
    });
  });

  await withMockedProviders({ groq: "test-groq-key" }, async () => new Response(
    JSON.stringify({ error: { message: "UPSTREAM_PRIVATE_OUTAGE" } }),
    { status: 503 },
  ), async () => {
    await assert.rejects(answerLifeOSQuestion(referenceInput()), (error: unknown) => {
      assert.ok(error instanceof AIAnalysisError);
      assert.equal(error.code, "provider_unavailable");
      assert.match(error.message, /API сейчас не отвечает|временно недоступен/i);
      assert.doesNotMatch(error.message, /UPSTREAM_PRIVATE_OUTAGE|test-groq-key/i);
      return true;
    });
  });
});

test("ошибки ключа и разрешений объясняются как настройка или доступ", async () => {
  await withMockedProviders({ gemini: "test-gemini-key" }, async () => providerError(401, {
    status: "UNAUTHENTICATED",
    message: "PRIVATE_INVALID_KEY_DETAILS",
  }), async () => {
    await assert.rejects(analyzeMessage(analysisInput()), (error: unknown) => {
      assert.ok(error instanceof AIAnalysisError);
      assert.equal(error.code, "provider_configuration");
      assert.match(error.message, /API-ключ, права проекта и название модели/i);
      assert.doesNotMatch(error.message, /PRIVATE_INVALID_KEY_DETAILS|test-gemini-key/i);
      return true;
    });
  });

  await withMockedProviders({ groq: "test-groq-key" }, async () => providerError(403, {
    code: "permission_denied",
    message: "PRIVATE_PROJECT_PERMISSION_DETAILS",
  }), async () => {
    await assert.rejects(answerLifeOSQuestion(referenceInput()), (error: unknown) => {
      assert.ok(error instanceof AIAnalysisError);
      assert.equal(error.code, "provider_configuration");
      assert.match(error.message, /права проекта/i);
      assert.doesNotMatch(error.message, /PRIVATE_PROJECT_PERMISSION_DETAILS|test-groq-key/i);
      return true;
    });
  });
});

test("смешанный отказ Gemini и Groq показывает причину для каждого провайдера", async () => {
  await withMockedProviders({ gemini: "test-gemini-key", groq: "test-groq-key" }, async (input) => {
    if (String(input).includes("generativelanguage.googleapis.com")) {
      return providerError(429, { status: "RESOURCE_EXHAUSTED", message: "PRIVATE_GEMINI_QUOTA" });
    }
    return providerError(503, { message: "PRIVATE_GROQ_OUTAGE" });
  }, async () => {
    await assert.rejects(analyzeMessage(analysisInput()), (error: unknown) => {
      assert.ok(error instanceof AIAnalysisError);
      assert.equal(error.code, "provider_mixed");
      assert.match(error.message, /Gemini: достигнут лимит запросов/i);
      assert.match(error.message, /Groq: API временно недоступен/i);
      assert.doesNotMatch(error.message, /PRIVATE_GEMINI_QUOTA|PRIVATE_GROQ_OUTAGE|test-(?:gemini|groq)-key/i);
      return true;
    });
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
