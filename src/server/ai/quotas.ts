import { createSign } from "node:crypto";

import type { AiQuotaMetric, AiQuotaSnapshot } from "@/domain/ai-quotas";

const MONITORING_SCOPE = "https://www.googleapis.com/auth/monitoring.read";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const MONITORING_URL = "https://monitoring.googleapis.com/v3";
const DASHBOARD_URL = "https://aistudio.google.com/" as const;
const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const MAX_CREDENTIALS_BYTES = 64 * 1024;
const MAX_PAGES = 4;
const PAGE_SIZE = 100;
const MAX_SERIES = MAX_PAGES * PAGE_SIZE;
const REQUEST_TIMEOUT_MS = 4_000;
const GOOGLE_QUERY_BUDGET_MS = 9_000;
const MAX_OUTPUT_METRICS = 12;

const QUOTA_METRICS = [
  {
    id: "requests",
    label: "Запросы генерации",
    unit: "requests",
    limitMetric: "generativelanguage.googleapis.com/quota/generate_content_free_tier_requests/limit",
    usageMetric: "generativelanguage.googleapis.com/quota/generate_content_free_tier_requests/usage",
  },
  {
    id: "input_tokens",
    label: "Входные токены",
    unit: "tokens",
    limitMetric: "generativelanguage.googleapis.com/quota/generate_content_free_tier_input_token_count/limit",
    usageMetric: "generativelanguage.googleapis.com/quota/generate_content_free_tier_input_token_count/usage",
  },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  unit: AiQuotaMetric["unit"];
  limitMetric: string;
  usageMetric: string;
}>;

type ServiceAccount = {
  client_email: string;
  private_key: string;
  project_id?: string;
};

type QuotaEnvironment = Partial<Pick<
  NodeJS.ProcessEnv,
  "GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON" | "GOOGLE_CLOUD_PROJECT_ID" | "GEMINI_MODEL"
>>;

type ApiTimeSeries = {
  metric?: { labels?: Record<string, string> };
  resource?: { labels?: Record<string, string> };
  points?: Array<{
    interval?: { startTime?: string; endTime?: string };
    value?: { int64Value?: string | number; doubleValue?: number };
  }>;
};
type ApiPointValue = NonNullable<NonNullable<ApiTimeSeries["points"]>[number]["value"]>;

type ParsedSeries = {
  key: string;
  limitName: string | null;
  location: string | null;
  points: Array<{ at: number; value: number }>;
};

export type GeminiQuotaOptions = {
  env?: QuotaEnvironment;
  fetch?: typeof fetch;
  now?: () => Date;
};

export async function getGeminiQuotaSnapshot(
  options: GeminiQuotaOptions = {},
): Promise<AiQuotaSnapshot> {
  const env = options.env ?? process.env;
  const credentialsJson = env.GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON?.trim();
  const model = sanitizeModel(env.GEMINI_MODEL?.trim() || DEFAULT_MODEL);

  if (!credentialsJson) {
    return makeSnapshot(model, "not_configured", [], null, "Google Cloud credentials ещё не настроены.");
  }

  const credentials = parseServiceAccount(credentialsJson);
  if (!credentials) {
    return makeSnapshot(model, "unavailable", [], null, "Конфигурация учётной записи Google Cloud некорректна.");
  }

  const projectId = (env.GOOGLE_CLOUD_PROJECT_ID?.trim() || credentials.project_id || "").trim();
  if (!isSafeProjectId(projectId)) {
    return makeSnapshot(model, "unavailable", [], null, "Не удалось определить проект Google Cloud.");
  }

  const fetchImpl = options.fetch ?? fetch;
  const now = options.now?.() ?? new Date();
  const deadline = Date.now() + GOOGLE_QUERY_BUDGET_MS;
  let accessToken: string;
  try {
    accessToken = await createAccessToken(credentials, fetchImpl, now, deadline);
  } catch {
    return makeSnapshot(model, "unavailable", [], null, "Не удалось получить доступ к Google Cloud.");
  }

  const intervalStart = startOfPacificDay(now);
  const queryResults = await Promise.all(
    QUOTA_METRICS.map(async (metric) => {
      const [limits, usage] = await Promise.all([
        readMetric({ projectId, model, metricType: metric.limitMetric, accessToken, start: intervalStart, end: now, fetchImpl, deadline }),
        readMetric({ projectId, model, metricType: metric.usageMetric, accessToken, start: intervalStart, end: now, fetchImpl, deadline }),
      ]);
      return { metric, limits, usage };
    }),
  );

  const permissionMissing = queryResults.some((result) =>
    [result.limits, result.usage].some((query) => query.error === "permission_missing"),
  );
  const failedQuery = queryResults.some((result) =>
    [result.limits, result.usage].some((query) => query.error === "unavailable"),
  );
  const hasData = queryResults
    .flatMap((result) => [...result.limits.series, ...result.usage.series])
    .some((series) => series.points.length > 0);
  const observedMs = queryResults
    .flatMap((result) => [...result.limits.series, ...result.usage.series])
    .flatMap((series) => series.points.map((point) => point.at).filter((at) => at <= now.getTime()))
    .reduce<number | null>((latest, value) => (latest === null || value > latest ? value : latest), null);

  const allMetrics = queryResults.flatMap(({ metric, limits, usage }) =>
    buildQuotaMetrics(metric, limits.series, usage.series, now),
  );
  const metrics = allMetrics.slice(0, MAX_OUTPUT_METRICS);
  const truncated = queryResults.some((result) => result.limits.truncated || result.usage.truncated) ||
    allMetrics.length > MAX_OUTPUT_METRICS;

  if (permissionMissing) {
    return makeSnapshot(
      model,
      "permission_missing",
      metrics,
      observedMs === null ? null : new Date(observedMs).toISOString(),
      "У сервисного аккаунта нет доступа к Google Cloud Monitoring. Нужна роль с правом monitoring.timeSeries.list.",
    );
  }
  if (failedQuery) {
    return makeSnapshot(
      model,
      "unavailable",
      metrics,
      observedMs === null ? null : new Date(observedMs).toISOString(),
      "Не удалось получить все метрики квот из Google Cloud Monitoring.",
    );
  }
  if (!hasData) {
    return makeSnapshot(
      model,
      "unavailable",
      emptyMetrics(),
      null,
      "Google Cloud Monitoring пока не вернул данные для этой модели. Проверьте включение метрик и повторите позже.",
    );
  }

  const incomplete = truncated || metrics.some((metric) => metric.limit === null || metric.used === null || metric.window === "unknown");
  return makeSnapshot(
    model,
    "ready",
    metrics,
    observedMs === null ? null : new Date(observedMs).toISOString(),
    incomplete
      ? "Показаны доступные данные; для некоторых квот Google пока не вернул лимит, период или свежее использование."
      : "Квоты прочитаны из Google Cloud Monitoring для выбранной модели и проекта.",
  );
}

export function buildMonitoringFilter(metricType: string, model: string): string {
  if (!metricType.startsWith("generativelanguage.googleapis.com/quota/")) {
    throw new Error("unsupported_metric");
  }
  const safeModel = sanitizeModel(model);
  return [
    'resource.type = "generativelanguage.googleapis.com/Location"',
    `metric.type = ${quoteFilterValue(metricType)}`,
    `metric.labels.model = ${quoteFilterValue(safeModel)}`,
  ].join(" AND ");
}

export function inferQuotaWindow(limitName: string | null | undefined): string {
  const normalized = (limitName ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalized.includes("perminute") || normalized.includes("permin")) return "per_minute";
  if (normalized.includes("perday") || normalized.includes("daily")) return "per_day";
  if (normalized.includes("perhour") || normalized.includes("hourly")) return "per_hour";
  return "unknown";
}

function makeSnapshot(
  model: string,
  status: AiQuotaSnapshot["status"],
  metrics: AiQuotaMetric[],
  observedAt: string | null,
  message: string,
): AiQuotaSnapshot {
  return { provider: "gemini", model, status, observedAt, metrics, message, dashboardUrl: DASHBOARD_URL };
}

function emptyMetrics(): AiQuotaMetric[] {
  return QUOTA_METRICS.map((metric) => ({
    id: metric.id,
    label: metric.label,
    limit: null,
    used: null,
    unit: metric.unit,
    window: null,
    updatedAt: null,
  }));
}

function parseServiceAccount(raw: string): ServiceAccount | null {
  if (Buffer.byteLength(raw, "utf8") > MAX_CREDENTIALS_BYTES) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.type !== "service_account") return null;
    if (typeof value.client_email !== "string" || !/^[^\s@]+@[^\s@]+$/.test(value.client_email)) return null;
    if (typeof value.private_key !== "string" || !value.private_key.includes("BEGIN PRIVATE KEY")) return null;
    return {
      client_email: value.client_email,
      private_key: value.private_key,
      ...(typeof value.project_id === "string" ? { project_id: value.project_id } : {}),
    };
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeProjectId(projectId: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9.-]{0,127}$/.test(projectId);
}

function sanitizeModel(model: string): string {
  const value = model.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(value)) return DEFAULT_MODEL;
  return value;
}

function quoteFilterValue(value: string): string {
  return JSON.stringify(value);
}

async function createAccessToken(
  credentials: ServiceAccount,
  fetchImpl: typeof fetch,
  now: Date,
  deadline: number,
): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const header = encodeBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = encodeBase64Url(
    JSON.stringify({
      iss: credentials.client_email,
      scope: MONITORING_SCOPE,
      aud: TOKEN_URL,
      iat: issuedAt,
      exp: issuedAt + 3600,
    }),
  );
  const unsignedAssertion = `${header}.${claims}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsignedAssertion);
  signer.end();
  const assertion = `${unsignedAssertion}.${signer.sign(credentials.private_key, "base64url")}`;

  const timeoutMs = Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now());
  if (timeoutMs <= 0) throw new Error("oauth_unavailable");
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("oauth_unavailable");

  const body: unknown = await response.json().catch(() => null);
  if (!isRecord(body) || typeof body.access_token !== "string" || body.access_token.length === 0) {
    throw new Error("oauth_unavailable");
  }
  return body.access_token;
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

type MetricQueryResult = {
  series: ParsedSeries[];
  error: "permission_missing" | "unavailable" | null;
  truncated: boolean;
};

async function readMetric(input: {
  projectId: string;
  model: string;
  metricType: string;
  accessToken: string;
  start: Date;
  end: Date;
  fetchImpl: typeof fetch;
  deadline: number;
}): Promise<MetricQueryResult> {
  const filter = buildMonitoringFilter(input.metricType, input.model);
  const baseUrl = `${MONITORING_URL}/projects/${encodeURIComponent(input.projectId)}/timeSeries`;
  const allSeries: ApiTimeSeries[] = [];
  let pageToken: string | undefined;
  let truncated = false;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const timeoutMs = Math.min(REQUEST_TIMEOUT_MS, input.deadline - Date.now());
    if (timeoutMs <= 0) {
      truncated = true;
      break;
    }
    const url = new URL(baseUrl);
    url.searchParams.set("filter", filter);
    url.searchParams.set("interval.startTime", input.start.toISOString());
    url.searchParams.set("interval.endTime", input.end.toISOString());
    url.searchParams.set("pageSize", String(PAGE_SIZE));
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    let response: Response;
    try {
      response = await input.fetchImpl(url, {
        headers: { Authorization: `Bearer ${input.accessToken}` },
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
    } catch {
      return { series: parseSeries(allSeries), error: "unavailable", truncated };
    }

    if (response.status === 403) return { series: parseSeries(allSeries), error: "permission_missing", truncated };
    if (!response.ok) return { series: parseSeries(allSeries), error: "unavailable", truncated };

    const body: unknown = await response.json().catch(() => null);
    if (!isRecord(body)) return { series: parseSeries(allSeries), error: "unavailable", truncated };
    const received = Array.isArray(body.timeSeries) ? body.timeSeries : [];
    for (const series of received) {
      if (!isRecord(series)) continue;
      allSeries.push(series as ApiTimeSeries);
      if (allSeries.length >= MAX_SERIES) break;
    }
    if (allSeries.length >= MAX_SERIES) {
      truncated = typeof body.nextPageToken === "string" && body.nextPageToken.length > 0;
      break;
    }
    if (typeof body.nextPageToken !== "string" || body.nextPageToken.length === 0) break;
    if (page === MAX_PAGES - 1) {
      truncated = true;
      break;
    }
    pageToken = body.nextPageToken;
  }

  return { series: parseSeries(allSeries), error: null, truncated };
}

function parseSeries(seriesList: ApiTimeSeries[]): ParsedSeries[] {
  const grouped = new Map<string, ParsedSeries>();
  for (const series of seriesList) {
    const labels = series.metric?.labels ?? {};
    const limitName = typeof labels.limit_name === "string" ? labels.limit_name : null;
    const location = typeof series.resource?.labels?.location === "string"
      ? series.resource.labels.location
      : null;
    const window = inferQuotaWindow(limitName);
    const key = `${limitName ?? window}\u0000${location ?? ""}`;
    const parsed = grouped.get(key) ?? { key, limitName, location, points: [] };
    for (const point of series.points ?? []) {
      const at = Date.parse(point.interval?.endTime ?? "");
      const value = readPointValue(point.value);
      if (Number.isFinite(at) && value !== null) parsed.points.push({ at, value });
    }
    grouped.set(key, parsed);
  }
  for (const series of grouped.values()) {
    const unique = new Map<string, { at: number; value: number }>();
    for (const point of series.points) unique.set(`${point.at}:${point.value}`, point);
    series.points = [...unique.values()].sort((left, right) => left.at - right.at);
  }
  return [...grouped.values()];
}

function readPointValue(value: ApiPointValue | undefined): number | null {
  if (!value) return null;
  const raw = value.doubleValue ?? value.int64Value;
  if (raw === undefined) return null;
  const parsed = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(parsed) && Math.abs(parsed) <= Number.MAX_SAFE_INTEGER ? parsed : null;
}

function buildQuotaMetrics(
  definition: (typeof QUOTA_METRICS)[number],
  limitSeries: ParsedSeries[],
  usageSeries: ParsedSeries[],
  now: Date,
): AiQuotaMetric[] {
  const usageByKey = new Map(usageSeries.map((series) => [series.key, series]));
  const limitByKey = new Map(limitSeries.map((series) => [series.key, series]));
  const keys = new Set([...limitByKey.keys(), ...usageByKey.keys()]);
  return [...keys].map((key) => {
    const limitData = limitByKey.get(key);
    const usageData = usageByKey.get(key);
    const series = limitData ?? usageData;
    const limitName = limitData?.limitName ?? usageData?.limitName ?? null;
    const window = inferQuotaWindow(limitName);
    const limitPoint = latestPoint(limitData?.points ?? [], now.getTime());
    const usedResult = usageValue(usageData?.points ?? [], window, now);
    const updatedAtMs = Math.max(limitPoint?.at ?? 0, usedResult.updatedAt ?? 0) || null;
    const locationSuffix = series?.location ? ` · ${series.location}` : "";
    const windowSuffix = window === "unknown" ? " · период не определён" : ` · ${windowLabel(window)}`;
    const stableWindow = window === "unknown" ? "unknown" : window;
    const locationId = series?.location ? `:${series.location.replace(/[^a-zA-Z0-9_-]/g, "-")}` : "";
    const limitSlug = limitName ? `:${limitName.replace(/[^a-zA-Z0-9_-]/g, "-")}` : "";
    return {
      id: `${definition.id}:${stableWindow}${locationId}${limitSlug}`,
      label: `${definition.label}${locationSuffix}${windowSuffix}`,
      limit: limitPoint?.value ?? null,
      used: usedResult.value,
      unit: definition.unit,
      window: stableWindow,
      updatedAt: updatedAtMs === null ? null : new Date(updatedAtMs).toISOString(),
    } satisfies AiQuotaMetric;
  });
}

function latestPoint(points: Array<{ at: number; value: number }>, now: number) {
  return [...points].filter((point) => point.at <= now).sort((left, right) => right.at - left.at)[0] ?? null;
}

function usageValue(
  points: Array<{ at: number; value: number }>,
  window: string,
  now: Date,
): { value: number | null; updatedAt: number | null } {
  const latest = latestPoint(points, now.getTime());
  if (!latest) return { value: null, updatedAt: null };
  const ageMs = now.getTime() - latest.at;
  if (ageMs > 5 * 60_000) return { value: null, updatedAt: latest.at };

  if (window === "per_minute") {
    const start = latest.at - 60_000;
    return {
      value: points.filter((point) => point.at > start && point.at <= latest.at).reduce((sum, point) => sum + point.value, 0),
      updatedAt: latest.at,
    };
  }
  if (window === "per_day") {
    const start = startOfPacificDay(now).getTime();
    return {
      value: points.filter((point) => point.at >= start && point.at <= now.getTime()).reduce((sum, point) => sum + point.value, 0),
      updatedAt: latest.at,
    };
  }
  if (window === "per_hour") {
    const start = latest.at - 60 * 60_000;
    return {
      value: points.filter((point) => point.at > start && point.at <= latest.at).reduce((sum, point) => sum + point.value, 0),
      updatedAt: latest.at,
    };
  }
  return { value: null, updatedAt: latest.at };
}

function windowLabel(window: string): string {
  if (window === "per_minute") return "за минуту";
  if (window === "per_day") return "за день";
  if (window === "per_hour") return "за час";
  return "период не определён";
}

function startOfPacificDay(date: Date): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const target = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day));
  let candidate = target;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const localParts = Object.fromEntries(formatter.formatToParts(new Date(candidate)).map((part) => [part.type, part.value]));
    const representedUtc = Date.UTC(
      Number(localParts.year),
      Number(localParts.month) - 1,
      Number(localParts.day),
      Number(localParts.hour),
      Number(localParts.minute),
      Number(localParts.second),
    );
    const adjustment = target - representedUtc;
    candidate += adjustment;
    if (adjustment === 0) break;
  }
  return new Date(candidate);
}
