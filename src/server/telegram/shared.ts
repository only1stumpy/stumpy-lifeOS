import { and, eq } from "drizzle-orm";
import { InlineKeyboard, type Context } from "grammy";
import * as schema from "@/db/schema";
import { getDb } from "@/db/client";
import { formatMoneyPlain as formatMoneyShared } from "@/domain/currencies";
import { ensureOwner } from "@/server/lifeos";
import { resolveTelegramUserId } from "@/server/owner-context";

/** Maps an incoming update to its persisted row id while the update is being handled. */
export const updateRowIds = new WeakMap<object, string>();

export function formatMoney(amountMinor: number, currency: string): string {
  return formatMoneyShared(amountMinor, currency);
}

export function round1(value: number): string {
  return (Math.round(value * 10) / 10).toLocaleString("ru-RU");
}

export function formatSigned(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded.toLocaleString("ru-RU")}`;
}

export async function isOwner(ctx: Context): Promise<boolean> {
  const fromId = ctx.from?.id;
  const scopedId = resolveTelegramUserId();
  return Boolean(scopedId && fromId && String(fromId) === scopedId);
}

export function getAppUrl(): string | null {
  const value = process.env.APP_URL?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function clearEditingCapture(id: string): Promise<void> {
  const owner = await ensureOwner();
  await getDb()
    .update(schema.ownerSettings)
    .set({ editingCaptureId: null, updatedAt: new Date() })
    .where(and(eq(schema.ownerSettings.id, owner.id), eq(schema.ownerSettings.editingCaptureId, id)));
}

export async function markMessage(ctx: Context, text: string): Promise<void> {
  if (ctx.callbackQuery?.message) {
    await ctx.api.editMessageText(ctx.callbackQuery.message.chat.id, ctx.callbackQuery.message.message_id, text, {
      reply_markup: new InlineKeyboard(),
    }).catch(() => ctx.reply(text));
  } else {
    await ctx.reply(text);
  }
}
