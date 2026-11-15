import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyReadme, type PackageMeta } from "./readme-badges";

// Usage: tsx scripts/sync-readme.ts [--check]
const root = resolve(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as PackageMeta;
const path = resolve(root, "README.md");
const current = readFileSync(path, "utf8");
const next = applyReadme(current, pkg);

if (process.argv.includes("--check")) {
  if (current !== next) {
    process.stderr.write("README.md расходится с package.json. Выполните: npm run docs:readme\n");
    process.exit(1);
  }
  process.stdout.write("README.md соответствует package.json.\n");
} else if (current !== next) {
  writeFileSync(path, next);
  process.stdout.write(`README.md обновлён: версия ${pkg.version}.\n`);
} else {
  process.stdout.write("README.md уже актуален.\n");
}
