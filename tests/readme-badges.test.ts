import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { applyReadme, renderBadges } from "../scripts/readme-badges";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

test("бейджи и версия в README соответствуют package.json (исправить: npm run docs:readme)", () => {
  assert.equal(applyReadme(readme, pkg), readme);
});

test("бейджи строятся из версии, движка Node и лицензии", () => {
  const badges = renderBadges({ version: "0.26.1", license: "AGPL-3.0-only", engines: { node: ">=24" } });
  assert.ok(badges.includes("версия-0.26.1-"));
  assert.ok(badges.includes("статус-бета-orange"));
  assert.ok(badges.includes("node-%3E%3D24-"));
  assert.ok(badges.includes("лицензия-AGPL--3.0-blue"));
});

test("статус зависит от версии: релиз-кандидат и стабильная", () => {
  assert.ok(renderBadges({ version: "1.0.0-rc.1" }).includes("статус-релиз--кандидат-yellow"));
  assert.ok(renderBadges({ version: "1.2.0" }).includes("статус-стабильная-green"));
});

test("без маркеров README обновление падает с понятной ошибкой", () => {
  assert.throws(() => applyReadme("# без маркеров", pkg), /маркеры/);
});
