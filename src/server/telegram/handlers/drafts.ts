import { eq } from "drizzle-orm";
import { InlineKeyboard, type Context } from "grammy";
import * as schema from "@/db/schema";
import { getDb } from "@/db/client";
import { formatMoney, round1 } from "@/server/telegram/shared";

function formatDraft(
  draft: {
    occurredAt: string;
    food: { label: string; portionLabel: string; calories: number; proteinGrams: number; fatGrams: number; carbsGrams: number; estimated: boolean } | null;
    money: { label: string; amountMinor: number; currency: string; kind: "expense" | "income"; category: string | null } | null;
    debt: { operation: "create" | "repayment"; personName: string; direction: "i_owe" | "owed_to_me"; amountMinor: number; openedAs: "transfer" | "opening_balance" | null; dueOn: string | null; note: string | null; remainingAmountMinor: number | null } | null;
  },
  timeZone: string,
  baseCurrency: string,
): string {
  let time: string;
  try {
    time = new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(draft.occurredAt));
  } catch {
    time = draft.occurredAt;
  }
  const lines = [`Проверь, пожалуйста · ${time}`];
  if (draft.food) {
    lines.push(`Еда: ${draft.food.label} · ${draft.food.portionLabel}`);
    lines.push(`КБЖУ: ${Math.round(draft.food.calories)} ккал · Б ${round1(draft.food.proteinGrams)} · Ж ${round1(draft.food.fatGrams)} · У ${round1(draft.food.carbsGrams)} г`);
    if (draft.food.estimated) lines.push("КБЖУ оценены примерно.");
  }
  if (draft.money) {
    lines.push(`${draft.money.kind === "income" ? "Доход" : "Расход"}: ${draft.money.label} · ${formatMoney(draft.money.amountMinor, draft.money.currency)}`);
    lines.push(draft.money.category ? `Категория: ${draft.money.category}` : "Категорию пока не распознал — выбери её через «Исправить».");
  }
  if (draft.debt) {
    const debt = draft.debt;
    const direction = debt.direction === "i_owe" ? `ты должен ${debt.personName}` : `${debt.personName} должен тебе`;
    if (debt.operation === "create") {
      lines.push(`Долг: ${direction} · ${formatMoney(debt.amountMinor, baseCurrency)}`);
      lines.push(debt.openedAs === "opening_balance" ? "Это текущий остаток, без записи операции задним числом." : "Создам финансовую операцию на выбранном счёте в основной валюте.");
      if (debt.dueOn) lines.push(`Срок: ${debt.dueOn}`);
      if (debt.note) lines.push(`Заметка: ${debt.note}`);
    } else {
      const verb = debt.direction === "i_owe" ? `Возврат ${debt.personName}` : `Возврат от ${debt.personName}`;
      lines.push(`${verb}: ${formatMoney(debt.amountMinor, baseCurrency)}`);
      if (debt.remainingAmountMinor !== null) lines.push(`Остаток после возврата: ${formatMoney(Math.max(0, debt.remainingAmountMinor - debt.amountMinor), baseCurrency)}`);
    }
  }
  return lines.join("\n");
}

export async function sendDraftMessage(ctx: Context, draft: Parameters<typeof formatDraft>[0] & { id: string }, timeZone: string, baseCurrency: string): Promise<void> {
  const sent = await ctx.reply(formatDraft(draft, timeZone, baseCurrency), { reply_markup: draftKeyboard(draft.id) });
  // Remembered so «Записать все» / «Отменить все» can remove the message later; failure here is harmless.
  await getDb().update(schema.captureDrafts).set({ telegramMessageId: sent.message_id }).where(eq(schema.captureDrafts.id, draft.id)).catch(() => undefined);
}

export function formatDraftList(drafts: { money: { label: string; amountMinor: number; currency: string; category: string | null } | null }[]): string {
  const lines = [`Проверь, пожалуйста · позиций: ${drafts.length}`];
  const totals = new Map<string, number>();
  drafts.forEach((draft, index) => {
    if (!draft.money) return;
    totals.set(draft.money.currency, (totals.get(draft.money.currency) ?? 0) + draft.money.amountMinor);
    lines.push(`${index + 1}. ${draft.money.label} · ${formatMoney(draft.money.amountMinor, draft.money.currency)} · ${draft.money.category ?? "без категории"}`);
  });
  lines.push("Итого: " + [...totals].map(([currency, amountMinor]) => formatMoney(amountMinor, currency)).join(" + "));
  lines.push("Каждая позиция запишется отдельной операцией. Отдельную позицию потом можно поправить или удалить в Mini App → Финансы.");
  return lines.join("\n");
}

export function bulkDraftKeyboard(updateRowId: string) {
  return new InlineKeyboard()
    .text("Записать все", `all:${updateRowId}`)
    .text("Отменить все", `none:${updateRowId}`);
}

function draftKeyboard(id: string) {
  return new InlineKeyboard()
    .text("Записать", `confirm:${id}`)
    .text("Исправить", `edit:${id}`)
    .row()
    .text("Отменить", `cancel:${id}`);
}
