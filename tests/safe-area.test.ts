import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

// Telegram reports the system inset and its own controls separately and they stack. Only globals.css and the
// Telegram sync in lifeos-root.tsx may read raw insets; everything else uses --lifeos-inset-top/bottom.
test("component styles use the shared safe-area variables, not raw insets", () => {
  const offenders = files("src")
    .filter((path) => path.endsWith(".css") && !path.endsWith("globals.css"))
    .filter((path) => /env\(safe-area-inset|--tg-(content-)?safe-area-inset/.test(readFileSync(path, "utf8")));
  assert.deepEqual(offenders, []);
});

// A component-local "safe" variable (e.g. --ob-safe-top) bypasses the shared inset and drifts from it.
test("components do not define their own safe-area variables", () => {
  const offenders = files("src")
    .filter((path) => /\.(css|tsx?)$/.test(path))
    .filter((path) => /--[\w-]*safe[\w-]*\s*[:"`]|"--[\w-]*safe[\w-]*"/.test(readFileSync(path, "utf8").replace(/--(?:tg|lifeos)-[\w-]*safe[\w-]*/g, "")))
    .filter((path) => !/(globals\.css|lifeos-root\.tsx|lifeos-app\.tsx|loading-skeletons\.tsx)$/.test(path));
  assert.deepEqual(offenders, []);
});
