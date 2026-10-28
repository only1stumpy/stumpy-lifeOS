import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync, verify } from "node:crypto";
import test from "node:test";

import { GET } from "../src/app/api/ai-quotas/route";
import { buildMonitoringFilter, getGeminiQuotaSnapshot, inferQuotaWindow } from "../src/server/ai/quotas";

const FIXED_NOW = new Date("2026-10-28T19:00:00.000Z");
const serviceKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKey = serviceKey.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicKey = serviceKey.publicKey;

function credentials(projectId = "lifeos-test-1234"): string {
  return JSON.stringify({
    type: "service_account",
    project_id: projectId,
    client_email: "lifeos-monitoring@example.iam.gserviceaccount.com",
    private_key: privateKey,
  });
}

function tokenResponse(): Response {
  return Response.json({ access_token: "test-access-token", expires_in: 3600, token_type: "Bearer" });
}

function point(at: Date, value: string | number) {
  return { interval: { endTime: at.toISOString() }, value: { int64Value: String(value) } };
}

function series(metricType: string, limitName: string, points: unknown[]) {
  return {
    metric: { type: metricType, labels: { model: "gemini-3.5-flash-lite", limit_name: limitName } },
    resource: { type: "generativelanguage.googleapis.com/Location", labels: { location: "global" } },
    points,
  };
}

test("JWT bearer использует monitoring.read, а модель безопасно фильтруется; ежедневная и минутная квоты считаются отдельно", async () => {
  const requests: Array<{ url: URL; init?: RequestInit }> = [];
  const now = FIXED_NOW;
  const latest = new Date(now.getTime() - 90_000);
  const fetchMock: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    if (url.href === "https://oauth2.googleapis.com/token") {
      const form = new URLSearchParams(String(init?.body));
      const assertion = form.get("assertion");
      assert.equal(form.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
      assert.ok(assertion);
      const [header, claims, signature] = assertion.split(".");
      assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), { alg: "RS256", typ: "JWT" });
      const payload = JSON.parse(Buffer.from(claims, "base64url").toString()) as { scope: string; aud: string; iss: string };
      assert.equal(payload.scope, "https://www.googleapis.com/auth/monitoring.read");
      assert.equal(payload.aud, "https://oauth2.googleapis.com/token");
      assert.equal(payload.iss, "lifeos-monitoring@example.iam.gserviceaccount.com");
      assert.equal(verify("RSA-SHA256", Buffer.from(`${header}.${claims}`), publicKey, Buffer.from(signature, "base64url")), true);
      return tokenResponse();
    }

    assert.equal(url.searchParams.get("pageSize"), "100");
    assert.match(url.searchParams.get("filter") ?? "", /metric\.labels\.model = "gemini-3\.5-flash-lite"/);
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-access-token");
    const filter = url.searchParams.get("filter") ?? "";
    const isLimit = filter.includes("/limit\"");
    const isRequestMetric = filter.includes("generate_content_free_tier_requests");
    const metricType = isRequestMetric
      ? `generativelanguage.googleapis.com/quota/generate_content_free_tier_requests/${isLimit ? "limit" : "usage"}`
      : `generativelanguage.googleapis.com/quota/generate_content_free_tier_input_token_count/${isLimit ? "limit" : "usage"}`;
    const limitName = isRequestMetric
      ? "GenerateContentRequestsPerDayPerProjectPerModel"
      : "GenerateContentInputTokensPerMinutePerModel";

    if (isLimit) {
      return Response.json({ timeSeries: [series(metricType, limitName, [point(new Date(now.getTime() - 60_000), isRequestMetric ? 100 : 32_000)])] });
    }
    if (isRequestMetric && !url.searchParams.has("pageToken")) {
      return Response.json({
        timeSeries: [series(metricType, limitName, [point(new Date(now.getTime() - 2 * 60_000), 3)])],
        nextPageToken: "safe-page-token",
      });
    }
    return Response.json({
      timeSeries: [series(metricType, limitName, [point(isRequestMetric ? new Date(now.getTime() - 3 * 60_000) : latest, isRequestMetric ? 2 : 2500),
        ...(!isRequestMetric ? [point(new Date(latest.getTime() - 60_000), 700)] : [])])],
    });
  };

  const snapshot = await getGeminiQuotaSnapshot({
    env: { GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON: credentials() },
    fetch: fetchMock,
    now: () => now,
  });

  assert.equal(snapshot.status, "ready");
  assert.equal(snapshot.model, "gemini-3.5-flash-lite");
  assert.equal(snapshot.metrics.length, 2);
  const requestMetric = snapshot.metrics.find((metric) => metric.id.startsWith("requests:"));
  const tokenMetric = snapshot.metrics.find((metric) => metric.id.startsWith("input_tokens:"));
  assert.equal(requestMetric?.window, "per_day");
  assert.equal(requestMetric?.limit, 100);
  assert.equal(requestMetric?.used, 5);
  assert.equal(tokenMetric?.window, "per_minute");
  assert.equal(tokenMetric?.limit, 32_000);
  assert.equal(tokenMetric?.used, 2500);
  assert.equal(requests.filter((request) => request.url.href === "https://oauth2.googleapis.com/token").length, 1);
  assert.ok(requests.some((request) => request.url.searchParams.get("pageToken") === "safe-page-token"));
  assert.equal(JSON.stringify(snapshot).includes(privateKey), false);
  assert.equal(JSON.stringify(snapshot).includes("test-access-token"), false);
});

test("Monitoring filters reject unsupported metric types and quote a model as one literal", () => {
  const filter = buildMonitoringFilter(
    "generativelanguage.googleapis.com/quota/generate_content_free_tier_requests/limit",
    'model\" OR metric.type = "other',
  );
  assert.match(filter, /metric\.labels\.model = "gemini-3\.5-flash-lite"/);
  assert.throws(() => buildMonitoringFilter("other.googleapis.com/metric", "model"), /unsupported_metric/);
  assert.equal(inferQuotaWindow("GenerateContentRequestsPerDayPerProjectPerModel"), "per_day");
  assert.equal(inferQuotaWindow("GenerateContentInputTokensPerMinutePerModel"), "per_minute");
  assert.equal(inferQuotaWindow("unknown"), "unknown");
});

test("отсутствующие credentials и пустые метрики имеют понятные состояния без обращения к Google", async () => {
  const absent = await getGeminiQuotaSnapshot({ env: {}, fetch: async () => { throw new Error("must not fetch"); }, now: () => FIXED_NOW });
  assert.equal(absent.status, "not_configured");
  assert.equal(absent.metrics.length, 0);

  const noData = await getGeminiQuotaSnapshot({
    env: { GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON: credentials() },
    fetch: async (input) => String(input) === "https://oauth2.googleapis.com/token"
      ? tokenResponse()
      : Response.json({ timeSeries: [] }),
    now: () => FIXED_NOW,
  });
  assert.equal(noData.status, "unavailable");
  assert.match(noData.message, /пока не вернул данные/);
  assert.equal(noData.metrics.length, 2);
  assert.equal(noData.metrics[0]?.limit, null);
  assert.equal(noData.metrics[0]?.used, null);
});

test("403 Monitoring отличает недостающие права и не раскрывает текст ошибки Google", async () => {
  const snapshot = await getGeminiQuotaSnapshot({
    env: { GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON: credentials() },
    fetch: async (input) => String(input) === "https://oauth2.googleapis.com/token"
      ? tokenResponse()
      : Response.json({ error: { message: "private-project-name forbidden" } }, { status: 403 }),
    now: () => FIXED_NOW,
  });
  assert.equal(snapshot.status, "permission_missing");
  assert.match(snapshot.message, /monitoring\.timeSeries\.list/);
  assert.doesNotMatch(JSON.stringify(snapshot), /private-project-name|test-access-token|BEGIN PRIVATE KEY/);
});

test("GET endpoint требует Telegram-владельца и отвечает без кеширования", async () => {
  const previousToken = process.env.TELEGRAM_BOT_TOKEN;
  const previousOwner = process.env.TELEGRAM_OWNER_ID;
  const previousCloudCredentials = process.env.GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON;
  process.env.TELEGRAM_BOT_TOKEN = "test-bot-token";
  process.env.TELEGRAM_OWNER_ID = "4242";
  delete process.env.GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON;
  try {
    const unauthorized = await GET(new Request("https://lifeos.test/api/ai-quotas"));
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.headers.get("Cache-Control"), "no-store");

    const query = signedInitData("test-bot-token", 4242);
    const authorized = await GET(new Request("https://lifeos.test/api/ai-quotas", {
      headers: { Authorization: `tma ${query}` },
    }));
    assert.equal(authorized.status, 200);
    assert.equal(authorized.headers.get("Cache-Control"), "no-store");
    const body = await authorized.json() as { status: string; provider: string };
    assert.equal(body.status, "not_configured");
    assert.equal(body.provider, "gemini");
  } finally {
    if (previousToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = previousToken;
    if (previousOwner === undefined) delete process.env.TELEGRAM_OWNER_ID;
    else process.env.TELEGRAM_OWNER_ID = previousOwner;
    if (previousCloudCredentials === undefined) delete process.env.GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON;
    else process.env.GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON = previousCloudCredentials;
  }
});

function signedInitData(botToken: string, ownerId: number): string {
  const now = Math.floor(Date.now() / 1000);
  const fields = new Map([
    ["auth_date", String(now)],
    ["user", JSON.stringify({ id: ownerId, first_name: "Owner" })],
  ]);
  const dataCheckString = [...fields.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value}`).join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  const params = new URLSearchParams([...fields.entries(), ["hash", hash]]);
  return params.toString();
}
