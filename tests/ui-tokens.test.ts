import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { tokensToCss, tokenVariables } from "../src/components/ui/tokens";

const parseCss = (css: string) => Object.fromEntries([...css.matchAll(/(--ui-[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name, value!.trim().replace(/\s+/g, " ")]));

// Two files hold the same palette (CSS for the app, TS for HTML strings); a value changed in one must change in the other.
test("tokens.css and tokens.ts hold the same variables with the same values", () => {
  const fromCss = parseCss(readFileSync("src/components/ui/tokens.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, ""));
  const fromTs = Object.fromEntries(Object.entries(tokenVariables()).map(([name, value]) => [name, value.replace(/\s+/g, " ")]));
  assert.deepEqual(fromTs, fromCss);
});

test("tokensToCss produces a block that parses back to the same variables", () => {
  const css = tokensToCss();
  assert.match(css, /^:root \{/);
  assert.deepEqual(parseCss(css), parseCss(readFileSync("src/components/ui/tokens.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "")));
});
