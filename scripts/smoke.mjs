// Smoke test of the production build: starts `next start` with placeholder secrets and checks
// that the app serves, reports its version and refuses unsigned API calls. Run after `npm run build`.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const port = process.env.SMOKE_PORT ?? "3199";
const base = `http://127.0.0.1:${port}`;
const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

// Run next directly (not through npx) in its own process group, so the whole tree can be stopped.
const nextBin = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const server = spawn(process.execPath, [nextBin, "start", "-p", port], {
  detached: true,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    TELEGRAM_BOT_TOKEN: "123456:smoke-test-token",
    DATABASE_URL: "postgres://smoke:smoke@127.0.0.1:1/smoke",
    AI_PROVIDER_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    TELEGRAM_WEBHOOK_SECRET: "s".repeat(40),
    CRON_SECRET: "c".repeat(40),
  },
});
// Whatever happens, never hang a CI job: hard stop after two minutes.
const watchdog = setTimeout(() => { console.error("smoke: timed out"); stop(); process.exit(1); }, 120_000);
function stop() { try { process.kill(-server.pid, "SIGKILL"); } catch { /* already gone */ } }
const get = (url, init = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
let log = "";
server.stdout.on("data", (chunk) => { log += chunk; });
server.stderr.on("data", (chunk) => { log += chunk; });

const failures = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` ${detail}`}`); if (!ok) failures.push(name); };

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await get(`${base}/api/health`)).ok) return true; } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

try {
  if (!(await waitForServer())) { console.error(log); throw new Error("server did not start"); }
  const health = await (await get(`${base}/api/health`)).json();
  check("/api/health status", health.status === "ok", JSON.stringify(health));
  check("/api/health version matches package.json", health.version === version, `${health.version} != ${version}`);
  const home = await get(`${base}/`);
  check("/ serves HTML", home.status === 200 && (home.headers.get("content-type") ?? "").includes("text/html"), String(home.status));
  check("security headers on /", Boolean(home.headers.get("content-security-policy")) && home.headers.get("x-content-type-options") === "nosniff");
  for (const path of ["/api/snapshot", "/api/export", "/api/ai-providers", "/api/ai-quotas"]) {
    check(`${path} refuses unsigned requests`, (await get(`${base}${path}`)).status === 401);
  }
  check("/api/cron refuses without secret", (await get(`${base}/api/cron`)).status === 401);
  check("/api/telegram refuses without secret", (await get(`${base}/api/telegram`, { method: "POST", body: "{}" })).status === 401);
} catch (error) {
  failures.push(String(error));
  console.error(error);
} finally {
  clearTimeout(watchdog);
  stop();
}
if (failures.length) { console.error(`smoke: ${failures.length} failed`); process.exit(1); }
console.log("smoke: all checks passed");
process.exit(0);
