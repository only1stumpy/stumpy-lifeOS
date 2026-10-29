import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptProviderApiKey,
  encryptProviderApiKey,
  toAiProviderProfileDto,
} from "../src/server/ai/provider-profiles";
import {
  classifyOpenAICompatibleFailure,
  extractOpenAICompatibleContent,
  AiProviderTransportError,
} from "../src/server/ai/openai-compatible";
import {
  areAllAddressesPublic,
  createRequestDeadline,
  isPublicIpAddress,
  SafeHttpsError,
  validateAiProviderEndpoint,
} from "../src/server/ai/safe-fetch";
import { analyzeMessage, answerLifeOSQuestion } from "../src/server/ai/analyze";
import { AIAnalysisError } from "../src/server/ai/types";

const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

test("API-ключ шифруется AES-GCM и расшифровывается только правильным ключом", () => {
  const secret = "sk-test-provider-secret-123";
  const ciphertext = encryptProviderApiKey(secret, ENCRYPTION_KEY);

  assert.match(ciphertext, /^v1:/);
  assert.doesNotMatch(ciphertext, /sk-test-provider-secret-123/);
  assert.equal(decryptProviderApiKey(ciphertext, ENCRYPTION_KEY), secret);
  assert.throws(
    () => decryptProviderApiKey(ciphertext, Buffer.alloc(32, 8).toString("base64")),
    /cannot be decrypted/i,
  );
  assert.throws(() => decryptProviderApiKey(ciphertext, "bad-key"), /неверный формат/i);
});

test("публичный DTO содержит только признак ключа и никогда не ciphertext", () => {
  const dto = toAiProviderProfileDto({
    id: "5ee727a0-28dc-4c9b-96eb-54f17f22a101",
    ownerId: "5ee727a0-28dc-4c9b-96eb-54f17f22a102",
    name: "Private provider",
    endpoint: "https://api.example.net/v1",
    model: "test-model",
    encryptedApiKey: "v1:encrypted-envelope-value",
    enabled: true,
    sortOrder: 0,
    createdAt: new Date("2026-10-29T10:00:00.000Z"),
    updatedAt: new Date("2026-10-29T10:00:00.000Z"),
  });

  assert.deepEqual(dto, {
    id: "5ee727a0-28dc-4c9b-96eb-54f17f22a101",
    name: "Private provider",
    endpoint: "https://api.example.net/v1",
    model: "test-model",
    enabled: true,
    sortOrder: 0,
    hasApiKey: true,
    createdAt: "2026-10-29T10:00:00.000Z",
    updatedAt: "2026-10-29T10:00:00.000Z",
  });
  assert.doesNotMatch(JSON.stringify(dto), /encrypted-envelope|"apiKey"|"ownerId"/i);
  assert.equal("encryptedApiKey" in dto, false);
  assert.equal("apiKey" in dto, false);
});

test("endpoint policy rejects insecure URLs and SSRF targets before network access", async () => {
  const invalid = [
    "http://api.example.com/v1",
    "https://localhost/v1",
    "https://anything.localhost/v1",
    "https://@api.example.com/v1",
    "https://127.0.0.1/v1",
    "https://10.2.3.4/v1",
    "https://172.16.0.1/v1",
    "https://192.168.0.5/v1",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/v1",
    "https://user:pass@api.example.com/v1",
    "https://api.example.com/v1?token=secret",
    "https://api.example.com/v1#fragment",
    "https://api.example.com/v1/%2e%2e/admin",
  ];

  for (const endpoint of invalid) {
    await assert.rejects(validateAiProviderEndpoint(endpoint), (error: unknown) => {
      assert.ok(error instanceof SafeHttpsError);
      assert.equal(error.kind, "configuration");
      return true;
    }, endpoint);
  }
});

test("проверка IP блокирует непубличные адреса IPv4/IPv6", () => {
  for (const address of [
    "0.0.0.0",
    "10.1.2.3",
    "100.64.2.3",
    "127.0.0.1",
    "169.254.169.254",
    "172.20.0.1",
    "192.168.1.1",
    "198.51.100.2",
    "203.0.113.9",
    "224.0.0.1",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
    "3fff:1::1",
    "2002:7f00:1::",
  ]) {
    assert.equal(isPublicIpAddress(address), false, address);
  }
  assert.equal(isPublicIpAddress("8.8.8.8"), true);
  assert.equal(isPublicIpAddress("2606:4700:4700::1111"), true);
  assert.equal(areAllAddressesPublic([{ address: "8.8.8.8" }, { address: "2606:4700:4700::1111" }]), true);
  assert.equal(areAllAddressesPublic([{ address: "8.8.8.8" }, { address: "127.0.0.1" }]), false);
  assert.equal(areAllAddressesPublic([]), false);
});

test("публичный HTTPS endpoint нормализуется без сетевого запроса", async () => {
  const endpoint = await validateAiProviderEndpoint("https://8.8.8.8/v1/");
  assert.equal(endpoint.endpoint, "https://8.8.8.8/v1");
  assert.deepEqual(endpoint.addresses, [{ address: "8.8.8.8", family: 4 }]);
});

test("OpenAI-compatible транспорт извлекает строковое и составное содержимое", () => {
  assert.equal(
    extractOpenAICompatibleContent(JSON.stringify({ choices: [{ message: { content: "  ответ  " } }] })),
    "  ответ  ",
  );
  assert.equal(
    extractOpenAICompatibleContent(JSON.stringify({ choices: [{ message: { content: [{ type: "text", text: "первый " }, { type: "text", text: "второй" }] } }] })),
    "первый второй",
  );
  assert.throws(() => extractOpenAICompatibleContent("not-json"), (error: unknown) => {
    assert.ok(error instanceof AiProviderTransportError);
    assert.equal(error.kind, "invalid_response");
    return true;
  });
});

test("ошибки API сопоставляются с безопасными категориями, а таймаут — с unavailable", () => {
  assert.equal(classifyOpenAICompatibleFailure(402, "{}"), "credits_exhausted");
  assert.equal(classifyOpenAICompatibleFailure(429, '{"error":{"code":"rate_limit_exceeded"}}'), "quota_exceeded");
  assert.equal(classifyOpenAICompatibleFailure(401, '{"error":{"message":"private body"}}'), "configuration");
  assert.equal(classifyOpenAICompatibleFailure(503, "private provider body"), "unavailable");
  assert.equal(classifyOpenAICompatibleFailure(200, "{}"), "other");

  const timeout = new AiProviderTransportError("unavailable");
  assert.equal(timeout.code, "provider_unavailable");
  assert.doesNotMatch(timeout.message, /private|secret|api\.example/i);
});

test("истёкший wall-clock deadline вызывает безопасную ошибку unavailable", async () => {
  const error = await new Promise<AiProviderTransportError>((resolve) => {
    createRequestDeadline(5, () => resolve(new AiProviderTransportError("unavailable")));
  });
  assert.equal(error.code, "provider_unavailable");
  assert.equal(error.kind, "unavailable");
});

test("пользовательская конфигурация не подхватывает deployment-wide ключи другого пользователя", async () => {
  const previousGeminiKey = process.env.GEMINI_API_KEY;
  const previousGroqKey = process.env.GROQ_API_KEY;
  process.env.GEMINI_API_KEY = "legacy-gemini-key";
  process.env.GROQ_API_KEY = "legacy-groq-key";

  try {
    const selection = { profiles: [], allowLegacyProviders: false };
    await assert.rejects(
      analyzeMessage({ text: "съел суп", timeZone: "Europe/Chisinau", now: "2026-10-29T12:00:00.000Z" }, selection),
      (error: unknown) => error instanceof AIAnalysisError && error.code === "not_configured",
    );
    await assert.rejects(
      answerLifeOSQuestion({ question: "Что такое белки?", context: "{}" }, selection),
      (error: unknown) => error instanceof AIAnalysisError && error.code === "not_configured",
    );
  } finally {
    if (previousGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousGeminiKey;
    if (previousGroqKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previousGroqKey;
  }
});
