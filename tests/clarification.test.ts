import assert from "node:assert/strict";
import test from "node:test";
import {
  activeClarificationHistory,
  appendClarificationTurn,
  nextClarificationHistory,
} from "../src/server/ai/clarification";

const now = new Date("2026-10-28T06:00:00.000Z");

test("история clarification переживает несколько уточнений и сохраняет исходное событие", () => {
  let history = nextClarificationHistory(null, "у меня на счету 742р", "Это доход или остаток по счёту?", false);
  assert.deepEqual(history, [
    { role: "user", text: "у меня на счету 742р" },
    { role: "assistant", text: "Это доход или остаток по счёту?" },
  ]);

  history = nextClarificationHistory(history, "доход", "Укажите источник дохода.", false);
  assert.deepEqual(history, [
    { role: "user", text: "у меня на счету 742р" },
    { role: "assistant", text: "Это доход или остаток по счёту?" },
    { role: "user", text: "доход" },
    { role: "assistant", text: "Укажите источник дохода." },
  ]);
  assert.deepEqual(activeClarificationHistory(history, now, now), history);
});

test("история не подмешивается после 30 минут и отбрасывает не текстовые данные", () => {
  const history = [
    { role: "user", text: "обед за 80 рублей", image: "must not persist" },
    { role: "assistant", text: "Это расход?" },
  ];
  const sanitized = appendClarificationTurn(null, "обед за 80 рублей", "Это расход?");

  assert.deepEqual(sanitized, [
    { role: "user", text: "обед за 80 рублей" },
    { role: "assistant", text: "Это расход?" },
  ]);
  assert.deepEqual(activeClarificationHistory(history, now, now), sanitized);
  assert.equal(activeClarificationHistory(history, new Date(now.getTime() - 30 * 60_000 - 1), now), null);
  assert.equal(activeClarificationHistory(history, new Date(now.getTime() + 1), now), null);
});

test("создание черновика очищает историю, а новое уточнение её продолжает", () => {
  const history = appendClarificationTurn(null, "у меня на счету 742р", "Это доход или остаток?");

  assert.equal(nextClarificationHistory(history, "доход", null, true), null);
  assert.deepEqual(
    nextClarificationHistory(history, "доход", "Какой источник дохода?", false),
    [...history, { role: "user", text: "доход" }, { role: "assistant", text: "Какой источник дохода?" }],
  );
});
