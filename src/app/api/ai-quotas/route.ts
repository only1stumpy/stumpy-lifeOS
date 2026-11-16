import { getAiProviderUsage } from "@/server/ai/provider-accounts";
import { getGeminiQuotaSnapshot } from "@/server/ai/quotas";
import { assertConsent, errorResponse, requireOwner } from "@/server/http";
import { enforceRateLimit, RATE_LIMITS } from "@/server/rate-limit";
import { ensureOwner } from "@/server/lifeos";
import { withTelegramUser } from "@/server/owner-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const user = requireOwner(request);
    await enforceRateLimit(RATE_LIMITS.aiQuotas, user.id);
    return await withTelegramUser(String(user.id), async () => {
      const owner = await ensureOwner();
      assertConsent(owner);
      const providers = await getAiProviderUsage(owner.id);
      const isLegacyOwner = Boolean(process.env.TELEGRAM_OWNER_ID && String(user.id) === process.env.TELEGRAM_OWNER_ID.trim());
      const legacyGemini = isLegacyOwner ? await getGeminiQuotaSnapshot().catch(() => null) : null;
      return Response.json({ providers, legacyGemini }, { headers: { "Cache-Control": "no-store" } });
    });
  } catch (error) {
    const response = errorResponse(error);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
