import { z } from "zod";
import { AI_PROVIDER_IDS } from "@/server/ai/provider-catalog";
import {
  connectAiProviderAccount,
  completeAiProviderOnboarding,
  deleteAiProviderAccount,
  listAiProviderCards,
  refreshAiProviderAccountModels,
  reorderAiProviderAccount,
  setAiProviderAccountEnabled,
  setAiProviderModelQueue,
} from "@/server/ai/provider-accounts";
import { AppError, assertConsent, errorResponse, requireOwner } from "@/server/http";
import { enforceRateLimit, RATE_LIMITS } from "@/server/rate-limit";
import { ensureOwner } from "@/server/lifeos";
import { withTelegramUser } from "@/server/owner-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const accountId = z.string().uuid();
const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("connect"),
    providerId: z.enum(AI_PROVIDER_IDS),
    name: z.string().trim().min(1).max(80),
    apiKey: z.string().trim().min(1).max(8_192),
    endpoint: z.string().trim().min(1).max(500).optional(),
    model: z.string().trim().min(1).max(200).optional(),
    cloudflareAccountId: z.string().trim().min(1).max(64).optional(),
    freeTierConfirmed: z.literal(true),
  }).strict(),
  z.object({
    action: z.literal("set-model-queue"),
    models: z.array(z.object({
      providerId: z.enum(AI_PROVIDER_IDS),
      modelId: z.string().trim().min(1).max(200),
    }).strict()).max(500),
  }).strict(),
  z.object({ action: z.literal("complete-onboarding") }).strict(),
  z.object({ action: z.literal("reorder-account"), accountId, position: z.number().int().min(0).max(19) }).strict(),
  z.object({ action: z.literal("toggle-account"), accountId, enabled: z.boolean() }).strict(),
  z.object({ action: z.literal("refresh-models"), accountId }).strict(),
]);

export async function GET(request: Request): Promise<Response> {
  try {
    const user = requireOwner(request);
    await enforceRateLimit(RATE_LIMITS.aiProviders, user.id);
    return await withTelegramUser(String(user.id), async () => {
      const owner = await ensureOwner();
      assertConsent(owner);
      const result = await listAiProviderCards(owner.id);
      return Response.json(result, { headers: { "Cache-Control": "no-store" } });
    });
  } catch (error) {
    const response = errorResponse(error);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const user = requireOwner(request);
    await enforceRateLimit(RATE_LIMITS.aiProviders, user.id);
    if (Number(request.headers.get("content-length") ?? 0) > 128_000) throw new AppError(413, "Слишком большой запрос.");
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > 128_000) throw new AppError(413, "Слишком большой запрос.");
    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { throw new AppError(400, "Некорректный запрос."); }
    const input = actionSchema.parse(payload);

    return await withTelegramUser(String(user.id), async () => {
      const owner = await ensureOwner();
      assertConsent(owner);
      switch (input.action) {
        case "connect": {
          const result = await connectAiProviderAccount(owner.id, {
            providerId: input.providerId,
            name: input.name,
            apiKey: input.apiKey,
            freeTierConfirmed: input.freeTierConfirmed,
            ...(input.endpoint ? { endpoint: input.endpoint } : {}),
            ...(input.model ? { model: input.model } : {}),
            ...(input.cloudflareAccountId ? { cloudflareAccountId: input.cloudflareAccountId } : {}),
          });
          return Response.json(result, { headers: { "Cache-Control": "no-store" } });
        }
        case "set-model-queue":
          await setAiProviderModelQueue(owner.id, input.models);
          break;
        case "complete-onboarding":
          await completeAiProviderOnboarding(owner.id);
          break;
        case "reorder-account":
          await reorderAiProviderAccount(owner.id, input.accountId, input.position);
          break;
        case "toggle-account":
          await setAiProviderAccountEnabled(owner.id, input.accountId, input.enabled);
          break;
        case "refresh-models":
          await refreshAiProviderAccountModels(owner.id, input.accountId);
          break;
      }
      return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    });
  } catch (error) {
    const response = errorResponse(error);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const user = requireOwner(request);
    await enforceRateLimit(RATE_LIMITS.aiProviders, user.id);
    const id = new URL(request.url).searchParams.get("id");
    if (!id || !accountId.safeParse(id).success) throw new AppError(400, "Некорректный аккаунт провайдера.");

    return await withTelegramUser(String(user.id), async () => {
      const owner = await ensureOwner();
      assertConsent(owner);
      await deleteAiProviderAccount(owner.id, id);
      return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    });
  } catch (error) {
    const response = errorResponse(error);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
