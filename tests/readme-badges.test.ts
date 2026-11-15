import assert from "node:assert/strict";
import test from "node:test";
import { applyReadme, renderBadges } from "../scripts/readme-badges";

const pkg = { version: "0.26.1" };

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
