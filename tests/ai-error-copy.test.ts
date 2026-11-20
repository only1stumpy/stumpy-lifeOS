import assert from "node:assert/strict";
import test from "node:test";
import { aiErrorAdminText, aiErrorUserMessage } from "../src/server/ai/error-copy";
import type { AIAnalysisErrorCode } from "../src/server/ai/types";

const CODES: AIAnalysisErrorCode[] = ["invalid_input", "not_configured", "provider_failed", "provider_mixed", "provider_unavailable", "provider_configuration", "quota_exceeded", "credits_exhausted", "invalid_response", "time_budget"];

test("every AI error code has a reason and an action", () => {
  for (const code of CODES) assert.ok(aiErrorUserMessage(code, "reference").length > 20, code);
});

test("quota points to another key, a bad key to the providers screen", () => {
  assert.match(aiErrorUserMessage("quota_exceeded", "reference"), /добавь другой ключ/);
  assert.match(aiErrorUserMessage("provider_configuration", "reference"), /«ИИ-провайдерах»/);
});

test("manual Mini App input is offered for records, not for questions", () => {
  assert.match(aiErrorUserMessage("invalid_response", "food"), /Mini App/);
  assert.doesNotMatch(aiErrorUserMessage("invalid_response", "reference"), /Mini App/);
});

test("admin text lists provider, model, HTTP status and kind of each attempt", () => {
  const text = aiErrorAdminText("quota_exceeded", [
    { provider: "gemini", model: "gemini-flash", kind: "quota_exceeded", status: 429 },
    { provider: "groq", model: "llama", kind: "unavailable" },
  ]);
  assert.match(text, /Gemini gemini-flash: quota_exceeded, HTTP 429/);
  assert.match(text, /Groq llama: unavailable/);
});
