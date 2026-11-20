import assert from "node:assert/strict";
import test from "node:test";

import { modulesNeedingSetup } from "../src/domain/section-setup";

const empty = { hasNutritionTarget: false, hasAccount: false };

test("раздел, включённый впервые без данных, получает настройку", () => {
  assert.deepEqual(modulesNeedingSetup(["gym"], ["nutrition", "finance", "gym"], empty), ["nutrition", "finance"]);
});

test("раздел с данными или уже включённый раньше не спрашивается", () => {
  assert.deepEqual(modulesNeedingSetup(["gym"], ["nutrition", "finance", "gym"], { hasNutritionTarget: true, hasAccount: true }), []);
  assert.deepEqual(modulesNeedingSetup(["nutrition", "finance"], ["nutrition", "finance"], empty), []);
  assert.deepEqual(modulesNeedingSetup(["nutrition"], ["nutrition", "finance"], { hasNutritionTarget: false, hasAccount: true }), []);
});

test("«Зал» заводить заранее нечего", () => {
  assert.deepEqual(modulesNeedingSetup(["nutrition"], ["nutrition", "gym"], empty), []);
});
