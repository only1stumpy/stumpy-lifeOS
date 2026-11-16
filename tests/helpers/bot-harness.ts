import { PRIVACY_POLICY_VERSION } from "../../src/domain/privacy";
import { connectAiProviderAccount } from "../../src/server/ai/provider-accounts";
import { withTelegramUser } from "../../src/server/owner-context";
import { getBot, resetBotForTests } from "../../src/server/telegram/client";
import { chatReply, startFakeProvider, type FakeReply, type FakeRequest } from "./fake-provider";
import { run } from "./command-db";

export type BotCall = { method: string; payload: Record<string, unknown> };

const BOT_TOKEN = "123456:bot-harness-token";
/** Telegram's own `OK` shape for the few methods the handlers read results from. */
function resultFor(method: string, payload: Record<string, unknown>, messageId: number) {
  if (method === "getMe") return { id: 1, is_bot: true, first_name: "LifeOS", username: "lifeos_test_bot", can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false };
  if (method === "sendMessage") return { message_id: messageId, date: 1, chat: { id: payload.chat_id, type: "private" }, text: String(payload.text ?? "") };
  return true;
}

/**
 * The real bot (middleware, commands, callbacks, messages) with Telegram's Bot API replaced by a recorder and
 * the AI provider replaced by a local HTTPS server. Everything between those two seams is production code.
 */
export async function createBotHarness() {
  const previousToken = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
  resetBotForTests();
  const bot = getBot();
  const calls: BotCall[] = [];
  let nextMessageId = 100;
  /** Return true to make this Bot API call fail like a Telegram outage. */
  let failWhen: ((call: BotCall) => boolean) | undefined;
  bot.api.config.use(async (_previous, method, payload) => {
    const call = { method, payload: payload as Record<string, unknown> };
    calls.push(call);
    if (failWhen?.(call)) return { ok: false, error_code: 502, description: "Bad Gateway: test outage" } as never;
    return { ok: true, result: resultFor(method, call.payload, nextMessageId += 1) } as never;
  });
  await bot.init();

  let aiReply: () => FakeReply = () => ({ status: 500, body: "{}" });
  const provider = await startFakeProvider((request: FakeRequest) => {
    if (request.method === "GET") return { body: JSON.stringify({ data: [{ id: "openai/gpt-oss-20b" }, { id: "openai/gpt-oss-120b" }] }) };
    if (request.body.includes("Reply with OK.")) return chatReply("OK");
    return aiReply();
  });

  let updateId = 1_000_000 + Math.floor(Math.random() * 1_000_000);
  const base = (telegramId: string) => ({ chat: { id: Number(telegramId), type: "private" as const }, from: { id: Number(telegramId), is_bot: false, first_name: "Tester" } });

  return {
    bot, calls, provider,
    /** What the AI will answer to the next message analysis. */
    answerAiWith(reply: FakeReply | (() => FakeReply)) { aiReply = typeof reply === "function" ? reply : () => reply; },
    aiAnalysisCalls: () => provider.requests.filter((request) => request.method === "POST" && !request.body.includes("Reply with OK.")),
    failBotApiWhen(predicate: ((call: BotCall) => boolean) | undefined) { failWhen = predicate; },
    sentTexts: () => calls.filter((call) => call.method === "sendMessage").map((call) => String(call.payload.text)),
    callsTo: (method: string) => calls.filter((call) => call.method === method),
    clearCalls: () => { calls.length = 0; },

    messageUpdate(telegramId: string, text: string, date = Math.floor(Date.now() / 1000)) {
      const entities = text.startsWith("/") ? [{ type: "bot_command" as const, offset: 0, length: text.split(/\s/)[0]!.length }] : undefined;
      updateId += 1;
      return { update_id: updateId, message: { message_id: updateId, date, ...base(telegramId), text, ...(entities ? { entities } : {}) } };
    },
    callbackUpdate(telegramId: string, data: string, messageId = 500) {
      updateId += 1;
      return { update_id: updateId, callback_query: { id: `cb${updateId}`, ...base(telegramId), chat_instance: "ci", data, message: { message_id: messageId, date: 1, ...base(telegramId), text: "draft" } } };
    },
    /** Delivers an update the way the webhook path does, scoped to the sending user. */
    deliver: (telegramId: string, update: Parameters<typeof bot.handleUpdate>[0]) => withTelegramUser(telegramId, () => bot.handleUpdate(update)),

    /** An owner who accepted the policy, has a PRB account and a connected (fake) AI provider. */
    async onboard(telegramId: string, options: { withAi?: boolean } = {}) {
      await run(telegramId, { type: "privacy.accept", version: PRIVACY_POLICY_VERSION });
      await run(telegramId, { type: "account.save", name: "Касса", currency: "PRB", openingBalanceMinor: 100_000, isDefault: true });
      if (options.withAi !== false) {
        const owner = await withTelegramUser(telegramId, async () => (await import("../../src/server/lifeos")).ensureOwner());
        await connectAiProviderAccount(owner.id, { providerId: "groq", name: "Тестовый Groq", apiKey: `fake-key-${telegramId}`, freeTierConfirmed: true });
        provider.requests.length = 0;
      }
    },
    async close() {
      await provider.close();
      resetBotForTests();
      if (previousToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
      else process.env.TELEGRAM_BOT_TOKEN = previousToken;
    },
  };
}

export const foodAndExpenseReply = (overrides: { calories?: number; amountMinor?: number } = {}) => chatReply(JSON.stringify({
  entries: [{
    food: { label: "Удон", portionLabel: "1 порция", calories: overrides.calories ?? 420, proteinGrams: 14, fatGrams: 9, carbsGrams: 70, estimated: true },
    money: { label: "Удон", amountMinor: overrides.amountMinor ?? 8500, currency: "PRB", kind: "expense", category: "Кафе и рестораны" },
    occurredAt: new Date().toISOString(),
  }],
  clarification: null,
}));
