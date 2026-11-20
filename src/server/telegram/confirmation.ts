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

const SUMMARY_MAX_ITEMS = 12;
const round1 = (value: number) => Math.round(value * 10) / 10;

export type SummaryDraft = {
  food: { label: string; calories: number; proteinGrams: number; fatGrams: number; carbsGrams: number } | null;
  money: { label: string; amountMinor: number; currency: string; kind: "expense" | "income"; category: string | null } | null;
  debt: { personName: string; amountMinor: number } | null;
  plan?: { name: string; amountMinor: number } | null;
};

/** One message after a bulk save: what was recorded, and what was not. */
export function formatBulkSummary(drafts: SummaryDraft[], total: number, problems: string[], baseCurrency: string): string {
  const items: string[] = [];
  for (const draft of drafts) {
    if (draft.food) items.push(`• Еда: ${draft.food.label} — ${Math.round(draft.food.calories)} ккал · Б ${round1(draft.food.proteinGrams)} · Ж ${round1(draft.food.fatGrams)} · У ${round1(draft.food.carbsGrams)}`);
    if (draft.money) items.push(`• ${draft.money.kind === "income" ? "Доход" : "Расход"}: ${draft.money.label} — ${formatMoneyShared(draft.money.amountMinor, draft.money.currency)}${draft.money.category ? ` · ${draft.money.category}` : ""}`);
    if (draft.plan) items.push(`• План: ${draft.plan.name} — ${formatMoneyShared(draft.plan.amountMinor, baseCurrency)}`);
    if (draft.debt) items.push(`• Долг: ${draft.debt.personName} — ${formatMoneyShared(draft.debt.amountMinor, baseCurrency)}`);
  }
  const shown = items.slice(0, SUMMARY_MAX_ITEMS);
  if (items.length > shown.length) shown.push(`…и ещё ${items.length - shown.length}`);
  return [`Записано ${drafts.length} из ${total}`, ...shown, ...problems.map((problem) => `Не записано: ${problem}`)].join("\n");
}
