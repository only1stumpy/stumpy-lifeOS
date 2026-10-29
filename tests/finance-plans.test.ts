import assert from "node:assert/strict";
import test from "node:test";

import { parseFinancePlanMessage } from "../src/domain/finance-plans";
import { commandSchema } from "../src/domain/commands";

test("план покупки разбирается по явному маркеру без срока", () => {
  const parsed = parseFinancePlanMessage("план куртка 1 500р.");

  assert.deepEqual(parsed, { name: "куртка", amountMinor: 150_000 });
});

test("распознаёт разговорную команду добавить покупку в планы", () => {
  assert.deepEqual(parseFinancePlanMessage("Запиши в планы шампунь за 220р"), {
    name: "шампунь",
    amountMinor: 22_000,
  });
  assert.deepEqual(parseFinancePlanMessage("Добавь в план новую куртку 1500"), {
    name: "новую куртку",
    amountMinor: 150_000,
  });
});

test("описание плана может содержать числа, сумма берётся из конца сообщения", () => {
  const parsed = parseFinancePlanMessage("план iPhone 16 Pro 25000");

  assert.deepEqual(parsed, { name: "iPhone 16 Pro", amountMinor: 2_500_000 });
});

test("план требует явный маркер, название и положительную сумму", () => {
  assert.equal(parseFinancePlanMessage("купить куртку 1500"), null);
  assert.equal(parseFinancePlanMessage("план 1500"), null);
  assert.equal(parseFinancePlanMessage("план куртка 0"), null);
  assert.equal(parseFinancePlanMessage("план куртка"), null);
});

test("команда создания плана принимает только название и сумму", () => {
  const command = commandSchema.parse({
    type: "finance-plan.save",
    name: "Куртка",
    amountMinor: 150_000,
  });

  assert.deepEqual(command, {
    type: "finance-plan.save",
    name: "Куртка",
    amountMinor: 150_000,
  });
});
