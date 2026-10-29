import assert from "node:assert/strict";
import test from "node:test";

import { parseDebtMessage } from "../src/domain/debt-message";

test("разбирает явные долги в обе стороны", () => {
  assert.deepEqual(parseDebtMessage("я должен Ивану 500"), {
    kind: "create",
    personName: "Ивану",
    direction: "i_owe",
    amountMinor: 50_000,
    openedAs: "transfer",
    dueOn: null,
    note: null,
  });
  assert.deepEqual(parseDebtMessage("Иван должен мне 500 руб."), {
    kind: "create",
    personName: "Иван",
    direction: "owed_to_me",
    amountMinor: 50_000,
    openedAs: "transfer",
    dueOn: null,
    note: null,
  });
});

test("разбирает заём у человека и выданные ему деньги", () => {
  assert.deepEqual(parseDebtMessage("занял 500 у Ивана"), {
    kind: "create",
    personName: "Ивана",
    direction: "i_owe",
    amountMinor: 50_000,
    openedAs: "transfer",
    dueOn: null,
    note: null,
  });
  assert.deepEqual(parseDebtMessage("одолжил Ивану 500"), {
    kind: "create",
    personName: "Ивану",
    direction: "owed_to_me",
    amountMinor: 50_000,
    openedAs: "transfer",
    dueOn: null,
    note: null,
  });
});

test("разбирает возврат долга в обе стороны", () => {
  assert.deepEqual(parseDebtMessage("вернул Ивану 200"), {
    kind: "repayment",
    personName: "Ивану",
    direction: "i_owe",
    amountMinor: 20_000,
  });
  assert.deepEqual(parseDebtMessage("Иван вернул 200"), {
    kind: "repayment",
    personName: "Иван",
    direction: "owed_to_me",
    amountMinor: 20_000,
  });
});

test("старый остаток помечается как начальный баланс", () => {
  for (const message of ["старый долг: я должен Ивану 500", "остаток долга — Иван должен мне 500", "добавь долг я должен Ивану 500"]) {
    const parsed = parseDebtMessage(message);
    assert.equal(parsed?.kind, "create");
    if (parsed?.kind === "create") assert.equal(parsed.openedAs, "opening_balance");
  }
});

test("суммы с дробной частью и пробелами точно переводятся в minor units", () => {
  const parsed = parseDebtMessage("я должен Ивану 1 234,56р");
  assert.equal(parsed?.kind, "create");
  if (parsed?.kind === "create") assert.equal(parsed.amountMinor, 123_456);
  assert.equal(parseDebtMessage("Иван должен мне 12.30 рубля")?.kind, "create");
});

test("обычные расходы, планы и неоднозначные сообщения не распознаются", () => {
  for (const message of [
    "обед 80 рублей",
    "план куртка 1500",
    "Ивану 500",
    "занял 500",
    "одолжил 500 Ивану",
    "вернул 200",
    "Иван должен 500",
  ]) {
    assert.equal(parseDebtMessage(message), null, message);
  }
});

test("отклоняет нулевые, некорректные и чрезмерные суммы, а также пустое имя", () => {
  for (const message of [
    "я должен Ивану 0",
    "я должен Ивану -5",
    "я должен Ивану 1.001",
    "я должен Ивану 10000000001",
    "я должен 500",
  ]) {
    assert.equal(parseDebtMessage(message), null, message);
  }
});
