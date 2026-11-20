import { spawn, type ChildProcess } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import * as schema from "../../src/db/schema";
import { createCommandDb, grantConsent, newTelegramId, ownerOf, run, snapshotOf } from "../helpers/command-db";

// Reusable screenshot run of the Mini App at 390x844 (dsf 2): same stand as miniapp.e2e.ts (production build,
// in-process route handlers on PGlite, signed initData, headless Chrome over CDP), but it only takes PNGs, so that
// "before" and "after" a UI change can be compared pair by pair. Needs `npm run build` and Chrome (CHROME_BIN).
//
//   node --import tsx --import ./tests/setup.ts tests/e2e/screenshots.ts [outDir] [--label before]
//
// outDir defaults to docs/audit/screens/<label>. A screen that cannot be opened is skipped with a warning.
const BOT_TOKEN = "123456:miniapp-shots-token";
process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
const PORT = process.env.MINIAPP_SHOTS_PORT ?? "3197";
const ORIGIN = `http://127.0.0.1:${PORT}`;

const args = process.argv.slice(2);
const labelIndex = args.indexOf("--label");
const label = labelIndex >= 0 ? args[labelIndex + 1] ?? "before" : "before";
const positional = args.filter((value, index) => !value.startsWith("--") && index !== labelIndex + 1);
const outDir = resolve(positional[0] ?? join("docs/audit/screens", label));

function signedInitData(userId: number) {
  const fields = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: "AAE-shots", user: JSON.stringify({ id: userId, first_name: "Tester", language_code: "ru" }) });
  const check = [...fields.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  fields.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return fields.toString();
}

const TELEGRAM_STUB = `(() => {
  const params = new URLSearchParams(location.hash.slice(1));
  const known = { initData: params.get("tgWebAppData") ?? "", version: "8.0", platform: "ios", colorScheme: "light", isFullscreen: false, isVersionAtLeast: () => false };
  window.Telegram = { WebApp: new Proxy(known, { get: (target, name) => (name in target ? target[name] : () => undefined) }) };
})();`;

let server: ChildProcess | undefined;
let chrome: ChildProcess | undefined;
let profileDir = "";
let ws: WebSocket;
const pending = new Map<number, (message: { result?: unknown; error?: { message: string } }) => void>();
type CdpParams = { requestId?: string; request?: { url: string; method: string; headers: Record<string, string>; postData?: string } };
const listeners: ((message: { method?: string; params?: CdpParams }) => void)[] = [];
let sequence = 0;
const send = <T = unknown>(method: string, params: Record<string, unknown> = {}) => new Promise<T>((resolvePromise, reject) => {
  const id = (sequence += 1);
  pending.set(id, (message) => (message.error ? reject(new Error(`${method}: ${message.error.message}`)) : resolvePromise(message.result as T)));
  ws.send(JSON.stringify({ id, method, params }));
});
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
const evaluate = async <T = unknown>(expression: string) => (await send<{ result: { value: T } }>("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
async function until(probe: () => Promise<boolean>, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (await probe().catch(() => false)) return true; await wait(150); }
  return false;
}

async function answerApi(url: URL, request: { method: string; headers: Record<string, string>; postData?: string }) {
  const route = await import(`../../src/app/api${url.pathname.slice("/api".length)}/route`).catch(() => null);
  const handler = route?.[request.method];
  if (!handler) return new Response("{}", { status: 404 });
  return handler(new Request(`http://localhost${url.pathname}${url.search}`, { method: request.method, headers: request.headers, ...(request.postData ? { body: request.postData } : {}) })) as Promise<Response>;
}

let mainUser = "";
const taken: string[] = [];
const skipped: string[] = [];
const skip = (name: string, why: string) => { skipped.push(`${name}: ${why}`); console.warn(`SKIP ${name}: ${why}`); };

/** Screenshot of the viewport, or of the whole page for long screens (the viewport is stretched to the content height so fixed bars stay at the bottom, capped). */
async function shot(name: string, full = true) {
  await wait(900); // spring animations and image decoding settle
  let stretched = false;
  if (full) {
    const height = await evaluate<number>("Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)");
    if (height > 844) {
      await send("Emulation.setDeviceMetricsOverride", { width: 390, height: Math.min(height, 6000), deviceScaleFactor: 2, mobile: true });
      stretched = true;
      await wait(700);
    }
  }
  const { data } = await send<{ data: string }>("Page.captureScreenshot", { format: "png" });
  if (stretched) await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(data, "base64"));
  taken.push(name);
  console.log(`ok   ${name}${full ? "" : " (viewport)"}`);
}

const textOf = () => evaluate<string>("document.body.innerText");
/** Clicks the first visible button/link whose text or aria-label matches. */
const clickText = (source: string, scope = "document") => evaluate<boolean>(`(() => {
  const re = new RegExp(${JSON.stringify(source)}, "i");
  const root = ${scope} ?? document;
  const el = [...root.querySelectorAll("button, a, [role=button]")].find((node) => node.getClientRects().length > 0 && !node.disabled && re.test((node.innerText || node.getAttribute("aria-label") || "").trim()));
  if (!el) return false;
  el.click();
  return true;
})()`);
const dock = (name: string) => evaluate<boolean>(`(() => { const el = document.querySelector('nav[aria-label="Разделы LifeOS"] button[aria-label="${name}"]'); if (!el) return false; el.click(); return true; })()`);
async function openTab(name: string) {
  if (!(await dock(name))) return false;
  return until(async () => evaluate<boolean>(`document.querySelector('nav[aria-label="Разделы LifeOS"] button[aria-label="${name}"]')?.getAttribute("aria-current") === "page"`));
}

async function openAs(telegramId: string, ready: RegExp) {
  await send("Page.navigate", { url: "about:blank" });
  await wait(300);
  await send("Page.navigate", { url: `${ORIGIN}/#tgWebAppData=${encodeURIComponent(signedInitData(Number(telegramId)))}` });
  return until(async () => ready.test(await textOf()) || (await evaluate<boolean>(`Boolean(document.querySelector('nav[aria-label="Разделы LifeOS"]'))`)), 25_000);
}

const buttonsHint = () => evaluate<string>(`[...document.querySelectorAll("button")].filter((b) => b.getClientRects().length).map((b) => (b.innerText || b.getAttribute("aria-label") || "").trim().slice(0, 30)).filter(Boolean).join(" | ")`).catch(() => "");

/** Opens a sheet (editor dialog or action sheet) from a tab by the text of the button, screenshots the viewport, closes it. */
async function editorShot(name: string, tab: string, buttonText: string, subTab?: string) {
  await openAs(mainUser, /Сегодня/); // a fresh load: no leftover settings page or sheet from the previous screen
  await wait(600);
  if (!(await openTab(tab))) return skip(name, `нет вкладки «${tab}»`);
  await wait(1100); // the tab content follows the dock with a transition
  if (subTab && !(await clickText(subTab))) return skip(name, `нет под-вкладки /${subTab}/. Кнопки: ${await buttonsHint()}`);
  await wait(400);
  if (!(await clickText(buttonText))) return skip(name, `нет кнопки /${buttonText}/ во вкладке «${tab}». Кнопки: ${await buttonsHint()}`);
  if (!(await until(() => evaluate<boolean>(`Boolean(document.querySelector("dialog[open], [class*=actionSheet]"))`), 5_000))) return skip(name, `шторка не открылась. Кнопки: ${await buttonsHint()}`);
  await shot(name, false);
  await evaluate(`(() => { const close = document.querySelector('button[aria-label="Закрыть панель"]'); if (close) close.click(); else document.querySelector("dialog[open]")?.close(); })()`);
  await until(() => evaluate<boolean>(`!document.querySelector("dialog[open], [class*=actionSheet]")`), 3_000);
  await wait(300);
}

async function settingsPage(name: string, title: string) {
  await dock("Сегодня");
  await wait(300);
  if (!(await openTab("Настройки"))) return skip(name, "нет вкладки «Настройки»");
  await wait(400);
  if (!(await clickText(title))) return skip(name, `нет пункта «${title}»`);
  await wait(600);
  await shot(name);
}

async function seed() {
  const { db } = await createCommandDb();
  const step = async (what: string, action: () => Promise<unknown>) => { try { await action(); } catch (error) { console.warn(`seed ${what}: ${(error as Error).message.slice(0, 160)}`); } };

  // Main user: everything enabled, some data in each module.
  const main = newTelegramId();
  const appVersion = (JSON.parse(readFileSync("package.json", "utf8")) as { version: string }).version;
  const now = new Date();
  const iso = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();
  const today = now.toISOString().slice(0, 10);
  await run(main, { type: "modules.save", modules: ["nutrition", "finance", "gym"] });
  await run(main, { type: "account.save", name: "Касса", currency: "PRB", openingBalanceMinor: 1_500_000, isDefault: true });
  const owner = await ownerOf(db, main);
  const [account] = await db.select().from(schema.financeAccounts).where(eq(schema.financeAccounts.ownerId, owner.id));
  await step("target", () => run(main, { type: "settings.save", timeZone: "UTC", target: { calories: 2200, proteinGrams: 130, fatGrams: 70, carbsGrams: 250 } }));
  await step("weight", () => run(main, { type: "weight.save", date: today, weightKg: 82.4 }));
  await step("food 1", () => run(main, { type: "food.save", label: "Овсянка с бананом", portionLabel: "1 порция", occurredAt: iso(0), estimated: false, calories: 420, proteinGrams: 14, fatGrams: 9, carbsGrams: 70 }));
  await step("food 2", () => run(main, { type: "food.save", label: "Куриная грудка с рисом", portionLabel: "350 г", occurredAt: iso(0), estimated: true, calories: 610, proteinGrams: 48, fatGrams: 12, carbsGrams: 72 }));
  await step("expense", () => run(main, { type: "money.save", label: "Хлеб и молоко", occurredAt: iso(0), amountMinor: 18_500, accountId: account!.id, category: "Продукты", kind: "expense" }));
  await step("income", () => run(main, { type: "money.save", label: "Зарплата", occurredAt: iso(1), amountMinor: 1_200_000, accountId: account!.id, category: "Доход", kind: "income" }));
  await step("plan", () => run(main, { type: "finance-plan.save", name: "Беговая дорожка", amountMinor: 4_500_000 }));
  await step("debt", () => run(main, { type: "debt.create", personName: "Антон", direction: "i_owe", amountMinor: 300_000, openedAs: "opening_balance", dueOn: null, note: null }));
  await step("gym", async () => {
    await run(main, { type: "day.save", name: "Верх тела", weekday: null });
    const [day] = await db.select().from(schema.workoutDays).where(eq(schema.workoutDays.ownerId, owner.id));
    await run(main, { type: "exercise.add", dayId: day!.id, name: "Жим лёжа", targetSets: 3, targetRepetitions: 8, restSeconds: 90, muscleGroup: "Грудь", equipment: "Штанга", instructions: "" });
    await run(main, { type: "exercise.add", dayId: day!.id, name: "Тяга верхнего блока", targetSets: 3, targetRepetitions: 10, restSeconds: 90, muscleGroup: "Спина", equipment: "Блок", instructions: "" });
    await run(main, { type: "session.start", dayId: day!.id });
  });
  // Without this the "what's new" sheet covers every screen on the first open.
  await step("version.seen", () => run(main, { type: "version.seen", version: appVersion }));

  // "What's new" sheet: a configured user who has not seen the current version.
  const news = newTelegramId();
  await step("news user", () => run(news, { type: "modules.save", modules: ["nutrition", "finance", "gym"] }));

  // Consent screen: owner row exists, but neither the policy nor the health consent is accepted.
  const noConsent = newTelegramId();
  await snapshotOf(noConsent);
  // Onboarding: consent given, modules not configured yet.
  const fresh = newTelegramId();
  await grantConsent(fresh);
  await snapshotOf(fresh);
  return { main, noConsent, fresh, news };
}

async function start() {
  const nextBin = join(process.cwd(), "node_modules/next/dist/bin/next");
  server = spawn(process.execPath, [nextBin, "start", "-p", PORT], { detached: true, stdio: "ignore", env: { ...process.env, TELEGRAM_BOT_TOKEN: BOT_TOKEN, DATABASE_URL: "postgres://shots:shots@127.0.0.1:1/shots" } });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { if ((await fetch(`${ORIGIN}/api/health`, { signal: AbortSignal.timeout(2_000) })).ok) break; } catch { /* not up yet */ }
    await wait(500);
  }
  profileDir = mkdtempSync(join(tmpdir(), "lifeos-shots-chrome-"));
  const debugPort = 9400 + Math.floor(Math.random() * 400);
  chrome = spawn(process.env.CHROME_BIN ?? "google-chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-first-run", "--hide-scrollbars", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDir}`, "about:blank"], { stdio: "ignore" });
  let target: { webSocketDebuggerUrl: string } | undefined;
  for (let attempt = 0; attempt < 160 && !target; attempt += 1) {
    await wait(250);
    try { target = ((await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[]).find((item) => item.type === "page"); } catch { /* chrome starting */ }
  }
  if (!target) throw new Error("Chrome не запустился");
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done) => ws.addEventListener("open", done, { once: true }));
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id && pending.has(message.id)) { pending.get(message.id)!(message); pending.delete(message.id); } else listeners.forEach((listener) => listener(message));
  });
  listeners.push((message) => {
    if (message.method !== "Fetch.requestPaused") return;
    const params = message.params ?? {};
    const request = params.request!;
    const fulfill = (status: number, body: Buffer | string, headers: Record<string, string>) => send("Fetch.fulfillRequest", {
      requestId: params.requestId,
      responseCode: status,
      responseHeaders: Object.entries(headers).map(([name, value]) => ({ name, value })),
      body: Buffer.from(body).toString("base64"),
    });
    const url = new URL(request.url);
    if (url.hostname === "telegram.org") { void fulfill(200, TELEGRAM_STUB, { "content-type": "application/javascript" }); return; }
    void answerApi(url, request).then(async (response) => fulfill(response.status, Buffer.from(await response.arrayBuffer()), { "content-type": response.headers.get("content-type") ?? "application/json" }));
  });
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Page.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "https://telegram.org/*" }, { urlPattern: `${ORIGIN}/api/*` }] });
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const users = await seed();
  mainUser = users.main;
  await start();

  if (!(await openAs(users.main, /Сегодня/))) throw new Error(`Mini App не открылась:\n${(await textOf()).slice(0, 600)}`);
  await wait(800);
  await shot("01-today");
  for (const [file, tab] of [["02-nutrition", "Питание"], ["03-finance", "Финансы"], ["04-gym", "Зал"], ["05-settings", "Настройки"]] as const) {
    if (await openTab(tab)) { await wait(500); await shot(file); } else skip(file, `нет вкладки «${tab}»`);
  }
  await settingsPage("06-personalization", "Персонализация");
  await settingsPage("07-ai-providers", "ИИ-провайдеры");
  await settingsPage("08-privacy", "Данные и приватность");

  // Sub-tabs of finance.
  await openAs(users.main, /Сегодня/);
  await wait(600);
  if (await openTab("Финансы")) {
    for (const [file, text] of [["03a-finance-operations", "^Операции$"], ["03b-finance-plans", "^Планы$"], ["03c-finance-debts", "^Долги$"]] as const) {
      if (await clickText(text)) { await wait(600); await shot(file); } else skip(file, `нет под-вкладки /${text}/. Кнопки: ${await buttonsHint()}`);
    }
  } else skip("03a-finance-operations", "нет вкладки «Финансы»");

  // Editor sheets.
  await editorShot("20-editor-food", "Питание", "Записать еду|Добавить еду|Добавить запись");
  await editorShot("21-editor-money", "Финансы", "Записать операцию|Добавить операцию");
  await editorShot("22-editor-plan", "Финансы", "Добавить|Новый план|Новая цель", "^Планы$");
  await editorShot("23-editor-debt", "Финансы", "Добавить|Новый долг|Записать долг", "^Долги$");
  await editorShot("24-editor-weight", "Питание", "^Добавить$");
  await editorShot("25-editor-gym-program", "Зал", "Собрать программу|Изменить");
  // Gym day page (a page, not a sheet).
  await openAs(users.main, /Сегодня/);
  await wait(600);
  if ((await openTab("Зал")) && (await wait(1100), await clickText("Верх тела"))) { await wait(600); await shot("27-gym-day"); } else skip("27-gym-day", "нет дня «Верх тела»");

  if (await openAs(users.news, /Что нового/)) { await shot("33-whats-new", false); } else skip("33-whats-new", "шторка «Что нового» не появилась");

  // Consent screen and onboarding: separate users, fresh page load each.
  if (await openAs(users.noConsent, /Перед началом/)) { await wait(500); await shot("30-consent"); } else skip("30-consent", "экран согласия не появился");
  if (await openAs(users.fresh, /Далее/)) {
    await wait(500);
    await shot("31-onboarding-1");
    if (await clickText("^Далее$")) { await wait(700); await shot("32-onboarding-2"); } else skip("32-onboarding-2", "нет кнопки «Далее»");
  } else skip("31-onboarding-1", "онбординг не появился");

  console.log(`\nГотово: ${taken.length} снимков в ${outDir}; пропущено: ${skipped.length}`);
  skipped.forEach((line) => console.log(`  - ${line}`));
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => {
    try { ws?.close(); } catch { /* already closed */ }
    chrome?.kill("SIGKILL");
    try { if (server?.pid) process.kill(-server.pid, "SIGKILL"); } catch { /* already gone */ }
    if (profileDir) rmSync(profileDir, { recursive: true, force: true });
    setTimeout(() => process.exit(), 200);
  });
