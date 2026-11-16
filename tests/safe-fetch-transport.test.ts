import assert from "node:assert/strict";
import test from "node:test";
import { safeHttpsGet, safeHttpsPost, SafeHttpsError } from "../src/server/ai/safe-fetch";
import { startFakeProvider } from "./helpers/fake-provider";

// Real TLS against a local server. The guard still validates the (public-looking) endpoint; only the final
// socket is redirected to the local server, so redirects, size limits and deadlines run through the real code.
const ENDPOINT = "https://8.8.8.8/v1";
const kindOf = (promise: Promise<unknown>) => promise.then(() => "ok", (error: unknown) => (error instanceof SafeHttpsError ? error.kind : `other:${String(error)}`));

test("POST: путь /chat/completions, Bearer-ключ и тело доходят до сервера, ответ возвращается целиком", async () => {
  const server = await startFakeProvider(() => ({ body: '{"ok":true}', headers: { "x-test": "1" } }));
  try {
    const response = await safeHttpsPost(ENDPOINT, "fake-key", { hello: "world" });
    assert.equal(response.status, 200);
    assert.equal(response.body, '{"ok":true}');
    assert.equal(response.headers["x-test"], "1");
    const [request] = server.requests;
    assert.equal(request?.method, "POST");
    assert.equal(request?.path, "/v1/chat/completions");
    assert.equal(request?.headers.authorization, "Bearer fake-key");
    assert.deepEqual(JSON.parse(request?.body ?? ""), { hello: "world" });
  } finally {
    await server.close();
  }
});

test("GET: заголовок x-goog-api-key и query-параметры от доверенного адаптера", async () => {
  const server = await startFakeProvider(() => ({ body: "{}" }));
  try {
    await safeHttpsGet(ENDPOINT, "fake-key", { authHeaderName: "x-goog-api-key", searchParams: { pageSize: "50" } });
    const [request] = server.requests;
    assert.equal(request?.method, "GET");
    assert.equal(request?.path, "/v1?pageSize=50");
    assert.equal(request?.headers["x-goog-api-key"], "fake-key");
    assert.equal(request?.headers.authorization, undefined);
  } finally {
    await server.close();
  }
});

test("редирект не выполняется: ответ 3xx — ошибка конфигурации, второго запроса нет", async () => {
  const server = await startFakeProvider(() => ({ status: 302, headers: { location: "https://169.254.169.254/latest/meta-data" } }));
  try {
    assert.equal(await kindOf(safeHttpsPost(ENDPOINT, "fake-key", {})), "configuration");
    assert.equal(server.requests.length, 1);
  } finally {
    await server.close();
  }
});

test("ответ больше лимита обрывается как invalid_response, ответ в пределах лимита проходит", async () => {
  const server = await startFakeProvider((request) => ({ body: request.path.endsWith("/chat/completions") ? "x".repeat(5_000) : "y".repeat(500) }));
  try {
    assert.equal(await kindOf(safeHttpsPost(ENDPOINT, "fake-key", {}, { maxResponseBytes: 2_048 })), "invalid_response");
    const small = await safeHttpsGet(ENDPOINT, "fake-key", { maxResponseBytes: 2_048 });
    assert.equal(small.body.length, 500);
  } finally {
    await server.close();
  }
});

test("сервер, который не отвечает, обрывается по дедлайну как unavailable", async () => {
  const server = await startFakeProvider(() => ({ hold: true }));
  try {
    const startedAt = Date.now();
    assert.equal(await kindOf(safeHttpsPost(ENDPOINT, "fake-key", {}, { timeoutMs: 1_000 })), "unavailable");
    assert.ok(Date.now() - startedAt < 5_000, "дедлайн сработал, а не бесконечное ожидание");
  } finally {
    await server.close();
  }
});

test("медленно сочащийся ответ тоже ограничен общим дедлайном", async () => {
  const server = await startFakeProvider(() => ({ delayMs: 3_000 }));
  try {
    assert.equal(await kindOf(safeHttpsGet(ENDPOINT, "fake-key", { timeoutMs: 1_000 })), "unavailable");
  } finally {
    await server.close();
  }
});

test("непубличные адреса отклоняются до соединения: сервер не видит ни одного запроса", async () => {
  const server = await startFakeProvider(() => ({}));
  try {
    for (const endpoint of ["https://127.0.0.1/v1", "https://10.0.0.5/v1", "https://169.254.169.254/v1", "https://[::1]/v1", "http://8.8.8.8/v1"]) {
      assert.equal(await kindOf(safeHttpsPost(endpoint, "fake-key", {})), "configuration", endpoint);
    }
    assert.equal(server.requests.length, 0);
  } finally {
    await server.close();
  }
});
