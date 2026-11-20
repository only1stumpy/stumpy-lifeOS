import assert from "node:assert/strict";
import test from "node:test";
import { decideLightMode, isSlowWindow, parsePerformanceClass, shouldMeasure, type LightInputs } from "../src/components/glass/light-mode";

const ua = (cls: string) => `Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 Telegram-Android/11.3.3 (Google sdk_gphone64_arm64; Android 14; SDK 34; ${cls})`;
const IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
const DESKTOP = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36";

test("UA: класс производительности Telegram Android", () => {
  assert.equal(parsePerformanceClass(ua("LOW")), "LOW");
  assert.equal(parsePerformanceClass(ua("AVERAGE")), "AVERAGE");
  assert.equal(parsePerformanceClass(ua("HIGH")), "HIGH");
  assert.equal(parsePerformanceClass(ua("high")), "HIGH");
  assert.equal(parsePerformanceClass(IOS), null);
  assert.equal(parsePerformanceClass(DESKTOP), null);
  assert.equal(parsePerformanceClass(ua("UNKNOWN")), null);
  assert.equal(parsePerformanceClass(""), null);
});

const base: LightInputs = { preference: "auto", osReduced: false, performanceClass: null, measuredSlow: false };

test("решение: ручной выбор > ОС > класс UA > замер", () => {
  assert.equal(decideLightMode({ ...base, preference: "on" }), true);
  assert.equal(decideLightMode({ ...base, preference: "off", osReduced: true, performanceClass: "LOW", measuredSlow: true }), false);
  assert.equal(decideLightMode({ ...base, osReduced: true, performanceClass: "HIGH" }), true);
  assert.equal(decideLightMode({ ...base, performanceClass: "LOW" }), true);
  assert.equal(decideLightMode({ ...base, performanceClass: "HIGH", measuredSlow: true }), false);
  assert.equal(decideLightMode({ ...base, performanceClass: "AVERAGE" }), false);
  assert.equal(decideLightMode({ ...base, performanceClass: "AVERAGE", measuredSlow: true }), true);
  assert.equal(decideLightMode(base), false);
  assert.equal(decideLightMode({ ...base, measuredSlow: true }), true);
});

test("замер запускается только для AVERAGE и неизвестного класса, не на iOS", () => {
  assert.equal(shouldMeasure({ ...base, performanceClass: "AVERAGE", userAgent: ua("AVERAGE") }), true);
  assert.equal(shouldMeasure({ ...base, userAgent: DESKTOP }), true);
  assert.equal(shouldMeasure({ ...base, userAgent: IOS }), false);
  assert.equal(shouldMeasure({ ...base, performanceClass: "HIGH", userAgent: ua("HIGH") }), false);
  assert.equal(shouldMeasure({ ...base, performanceClass: "LOW", userAgent: ua("LOW") }), false);
  assert.equal(shouldMeasure({ ...base, preference: "on", userAgent: DESKTOP }), false);
  assert.equal(shouldMeasure({ ...base, preference: "off", userAgent: DESKTOP }), false);
  assert.equal(shouldMeasure({ ...base, osReduced: true, userAgent: DESKTOP }), false);
  assert.equal(shouldMeasure({ ...base, measuredSlow: true, userAgent: DESKTOP }), false);
});

test("окно кадров: медиана выше порога медленная, 30 fps и 60 fps нет", () => {
  assert.equal(isSlowWindow(Array(45).fill(16.7)), false);
  assert.equal(isSlowWindow(Array(45).fill(33.4)), false);
  assert.equal(isSlowWindow(Array(45).fill(50)), true);
  assert.equal(isSlowWindow([...Array(10).fill(120), ...Array(35).fill(16.7)]), false);
  assert.equal(isSlowWindow([]), false);
});
