import { formatMoneyPlain as formatMoneyShared } from "@/domain/currencies";
type FoodRecord = {
  name: string;
  portionLabel: string;
  calories: number | string;
  proteinGrams: number | string;
  fatGrams: number | string;
  carbsGrams: number | string;
};

type MoneyRecord = {
  name: string;
  entryType: "expense" | "income";
  amount: number | string;
  currency: string;
};

type ConfirmedRecords = {
  food: FoodRecord | null;
  money: MoneyRecord | null;
};

export type ConfirmationText = {
  callbackText: string;
  messageText: string;
};

const MISSING_RECORD_TEXT = "Не нашёл сохранённую запись после подтверждения. Проверь дневник и, если записи нет, отправь сообщение ещё раз.";

export function formatConfirmedRecords({ food, money }: ConfirmedRecords): ConfirmationText {
  if (!food && !money) {
    return {
      callbackText: "Запись не найдена — проверь дневник.",
      messageText: MISSING_RECORD_TEXT,
    };
  }

  if (food && money) {
    const moneyKind = money.entryType === "income" ? "доход" : "расход";
    return {
      callbackText: shortCallbackText(`Еда: ${food.name} · ${moneyKind}: ${money.name} ${formatMoney(money.amount, money.currency)}`),
      messageText: [
        "Записал:",
        `Еда — ${food.name} · ${food.portionLabel} · ${formatInteger(food.calories)} ккал`,
        `${capitalize(moneyKind)} — ${money.name} · ${formatMoney(money.amount, money.currency)}`,
      ].join("\n"),
    };
  }

  if (food) {
    return {
      callbackText: shortCallbackText(`${food.name} · ${food.portionLabel} записано`),
      messageText: [
        `Записал еду: ${food.name} · ${food.portionLabel}`,
        `КБЖУ: ${formatInteger(food.calories)} ккал · Б ${formatQuantity(food.proteinGrams)} · Ж ${formatQuantity(food.fatGrams)} · У ${formatQuantity(food.carbsGrams)} г`,
      ].join("\n"),
    };
  }

  if (money) {
    const moneyKind = money.entryType === "income" ? "доход" : "расход";
    return {
      callbackText: shortCallbackText(`${capitalize(moneyKind)}: ${money.name} · ${formatMoney(money.amount, money.currency)} ${money.entryType === "income" ? "зачислен" : "записан"}`),
      messageText: `Записал ${moneyKind}: ${money.name} · ${formatMoney(money.amount, money.currency)}`,
    };
  }

  return {
    callbackText: "Запись не найдена — проверь дневник.",
    messageText: MISSING_RECORD_TEXT,
  };
}

export function formatRecurringConfirmation(payment: Pick<MoneyRecord, "name" | "amount" | "currency">): ConfirmationText {
  const amount = formatMoney(payment.amount, payment.currency);
  return {
    callbackText: shortCallbackText(`Оплата ${payment.name} · ${amount} записана`),
    messageText: `Записал оплату: ${payment.name} · ${amount}`,
  };
}

function formatMoney(amount: number | string, currency: string): string {
  return formatMoneyShared(Math.round(Number(amount) * 100), currency);
}

function formatQuantity(value: number | string): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(Number(value));
}

function formatInteger(value: number | string): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Math.round(Number(value)));
}

function capitalize(value: string): string {
  return value.charAt(0).toLocaleUpperCase("ru-RU") + value.slice(1);
}

function shortCallbackText(value: string): string {
  return Array.from(value).slice(0, 180).join("");
}
