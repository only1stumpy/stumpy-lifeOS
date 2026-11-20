import assert from "node:assert/strict";
import test from "node:test";
import { isWeakDevice, resolveLightMode } from "../src/components/glass/light-mode";

test("light mode: слабым считается Android в Telegram, малая память, мало ядер, reduced motion", () => {
  assert.equal(isWeakDevice({ platform: "android" }), true);
  assert.equal(isWeakDevice({ deviceMemory: 4 }), true);
  assert.equal(isWeakDevice({ hardwareConcurrency: 4 }), true);
  assert.equal(isWeakDevice({ reducedMotion: true }), true);
  assert.equal(isWeakDevice({ platform: "ios", deviceMemory: 8, hardwareConcurrency: 8, reducedMotion: false }), false);
  assert.equal(isWeakDevice({}), false);
});

test("light mode: ручной выбор сильнее автоопределения", () => {
  assert.equal(resolveLightMode("auto", true), true);
  assert.equal(resolveLightMode("auto", false), false);
  assert.equal(resolveLightMode("on", false), true);
  assert.equal(resolveLightMode("off", true), false);
});
