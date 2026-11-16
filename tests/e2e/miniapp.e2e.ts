import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import * as schema from "../../src/db/schema";
import { createCommandDb, newTelegramId, ownerOf, run } from "../helpers/command-db";

// Mini App screens in a real browser, without AI. The page is served by the production build (`next start`);
// the browser's /api calls are answered by the real route handlers running against PGlite in this process, and
// the Telegram script is replaced by a stub that exposes a correctly signed initData. Needs `npm run build`
// and Chrome (CHROME_BIN, default `google-chrome`). Not part of `npm test`: it is run as `npm run test:miniapp`.
const BOT_TOKEN = "123456:miniapp-e2e-token";
process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
const PORT = process.env.MINIAPP_E2E_PORT ?? "3198";
const ORIGIN = `http://127.0.0.1:${PORT}`;

function signedInitData(userId: number) {
  const fields = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: "AAE-e2e", user: JSON.stringify({ id: userId, first_name: "Tester", language_code: "ru" }) });
  const check = [...fields.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  fields.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return fields.toString();
}

/** What telegram-web-app.js would expose inside Telegram: the signed initData, and harmless no-ops for the rest. */
const TELEGRAM_STUB = `(() => {
  const params = new URLSearchParams(location.hash.slice(1));
  const known = { initData: params.get("tgWebAppData") ?? "", version: "8.0", platform: "ios", colorScheme: "light", isFullscreen: false, isVersionAtLeast: () => false };
  window.Telegram = { WebApp: new Proxy(known, { get: (target, name) => (name in target ? target[name] : () => undefined) }) };
})();`;

let server: ChildProcess;
let chrome: ChildProcess;
let profileDir: string;
let ws: WebSocket;
const problems: string[] = [];
const pending = new Map<number, (message: { result?: unknown; error?: { message: string } }) => void>();
type CdpParams = {
  type?: string;
  requestId?: string;
  exceptionDetails?: { text?: string; exception?: { description?: string } };
  args?: { value?: string; description?: string }[];
  response?: { url: string; status: number };
  request?: { url: string; method: string; headers: Record<string, string>; postData?: string };
};
const listeners: ((message: { method?: string; params?: CdpParams }) => void)[] = [];
let sequence = 0;
const send = <T = unknown>(method: string, params: Record<string, unknown> = {}) => new Promise<T>((resolve, reject) => {
  const id = (sequence += 1);
  pending.set(id, (message) => (message.error ? reject(new Error(`${method}: ${message.error.message}`)) : resolve(message.result as T)));
  ws.send(JSON.stringify({ id, method, params }));
});
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const evaluate = async <T = unknown>(expression: string) => (await send<{ result: { value: T } }>("Runtime.evaluate", { expression, returnByValue: true })).result.value;
async function until(description: string, probe: () => Promise<boolean>, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (await probe()) return; await wait(150); }
  throw new Error(`timed out: ${description}\n${problems.join("\n")}\n${await evaluate<string>("document.body.innerText").catch(() => "")}`.slice(0, 1500));
}

async function answerApi(url: URL, request: { method: string; headers: Record<string, string>; postData?: string }) {
  const route = await import(`../../src/app/api${url.pathname.slice("/api".length)}/route`).catch(() => null);
  const handler = route?.[request.method];
  if (!handler) return new Response("{}", { status: 404 });
  return handler(new Request(`http://localhost${url.pathname}${url.search}`, { method: request.method, headers: request.headers, ...(request.postData ? { body: request.postData } : {}) })) as Promise<Response>;
}

before(async () => {
  const { db } = await createCommandDb();
  const telegramId = newTelegramId();
  await run(telegramId, { type: "modules.save", modules: ["nutrition", "finance", "gym"] });
  await run(telegramId, { type: "account.save", name: "Касса", currency: "PRB", openingBalanceMinor: 100_000, isDefault: true });
  const owner = await ownerOf(db, telegramId);
  const [account] = await db.select().from(schema.financeAccounts).where(eq(schema.financeAccounts.ownerId, owner.id));
  await run(telegramId, { type: "money.save", label: "Хлеб из сида", occurredAt: new Date().toISOString(), amountMinor: 1500, accountId: account!.id, category: "Продукты", kind: "expense" });

  const nextBin = join(process.cwd(), "node_modules/next/dist/bin/next");
  server = spawn(process.execPath, [nextBin, "start", "-p", PORT], {
    detached: true,
    stdio: "ignore",
    // The database URL only has to be present: the page reads it to know the app is configured; data comes from the in-process routes.
    env: { ...process.env, TELEGRAM_BOT_TOKEN: BOT_TOKEN, DATABASE_URL: "postgres://e2e:e2e@127.0.0.1:1/e2e" },
  });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { if ((await fetch(`${ORIGIN}/api/health`, { signal: AbortSignal.timeout(2_000) })).ok) break; } catch { /* not up yet */ }
    await wait(500);
  }

  profileDir = mkdtempSync(join(tmpdir(), "lifeos-e2e-chrome-"));
  const debugPort = 9400 + Math.floor(Math.random() * 400);
  chrome = spawn(process.env.CHROME_BIN ?? "google-chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDir}`, "about:blank"], { stdio: "ignore" });
  let target: { webSocketDebuggerUrl: string } | undefined;
  for (let attempt = 0; attempt < 60 && !target; attempt += 1) {
    await wait(250);
    try { target = ((await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[]).find((item) => item.type === "page"); } catch { /* chrome starting */ }
  }
  assert.ok(target, "Chrome не запустился");
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id && pending.has(message.id)) { pending.get(message.id)!(message); pending.delete(message.id); } else listeners.forEach((listener) => listener(message));
  });

  listeners.push((message) => {
    const params = message.params ?? {};
    if (message.method === "Runtime.exceptionThrown") problems.push(`exception: ${params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text}`);
    if (message.method === "Runtime.consoleAPICalled" && params.type === "error") problems.push(`console.error: ${(params.args ?? []).map((arg) => arg.value ?? arg.description).join(" ")}`);
    if (message.method === "Network.responseReceived" && params.response && params.response.url.startsWith(`${ORIGIN}/api/`) && params.response.status >= 400) problems.push(`api ${params.response.status} ${params.response.url}`);
    if (message.method !== "Fetch.requestPaused") return;
    const request = params.request!;
    const fulfill = (status: number, body: Buffer | string, headers: Record<string, string>) => send("Fetch.fulfillRequest", {
      requestId: params.requestId,
      responseCode: status,
      responseHeaders: Object.entries(headers).map(([name, value]) => ({ name, value })),
      body: Buffer.from(body).toString("base64"),
    });
    const url = new URL(request.url);
    if (url.hostname === "telegram.org") {
      void fulfill(200, TELEGRAM_STUB, { "content-type": "application/javascript" });
      return;
    }
    void answerApi(url, request).then(async (response) => fulfill(response.status, Buffer.from(await response.arrayBuffer()), { "content-type": response.headers.get("content-type") ?? "application/json" }));
  });
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Page.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "https://telegram.org/*" }, { urlPattern: `${ORIGIN}/api/*` }] });
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send("Page.navigate", { url: `${ORIGIN}/#tgWebAppData=${encodeURIComponent(signedInitData(Number(telegramId)))}` });
});

after(() => {
  try { ws?.close(); } catch { /* already closed */ }
  chrome?.kill("SIGKILL");
  try { if (server?.pid) process.kill(-server.pid, "SIGKILL"); } catch { /* already gone */ }
  if (profileDir) rmSync(profileDir, { recursive: true, force: true });
});

const dockButton = (label: string) => `document.querySelector('nav[aria-label="Разделы LifeOS"] button[aria-label="${label}"]')`;

test("Mini App открывается с подписанным initData и показывает док из пяти разделов без ИИ", async () => {
  await until("док появился", async () => evaluate<boolean>(`Boolean(${dockButton("Сегодня")})`));
  for (const label of ["Сегодня", "Питание", "Финансы", "Зал", "Настройки"]) {
    assert.equal(await evaluate<boolean>(`Boolean(${dockButton(label)})`), true, `кнопка дока «${label}»`);
  }
  assert.equal(await evaluate<string>(`${dockButton("Сегодня")}.getAttribute("aria-current")`), "page");
});

test("каждый раздел открывается, не падает и не делает запросов, кроме успешных", async () => {
  const expectations: [string, RegExp][] = [
    ["Питание", /ккал|Питание|Еда/i],
    ["Финансы", /Хлеб из сида|Касса/],
    ["Зал", /Зал|трениров|упражнен/i],
    ["Настройки", /ИИ-провайдеры/],
    ["Сегодня", /Сегодня|ккал|Баланс|Касса/i],
  ];
  for (const [label, marker] of expectations) {
    await evaluate(`${dockButton(label)}.click()`);
    await until(`раздел «${label}» активен`, async () => (await evaluate<string>(`${dockButton(label)}.getAttribute("aria-current")`)) === "page");
    await until(`в разделе «${label}» есть ожидаемый текст`, async () => marker.test(await evaluate<string>("document.body.innerText")), 8_000);
  }
  const text = await evaluate<string>("document.body.innerText");
  assert.doesNotMatch(text, /Не удалось загрузить|Something went wrong/i);
  assert.deepEqual(problems, [], "ошибки страницы и неуспешные API-ответы");
});
