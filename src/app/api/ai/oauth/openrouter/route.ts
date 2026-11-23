import { z } from "zod";
import { getOpenRouterOAuthStatus, startOpenRouterOAuth } from "@/server/ai/openrouter-oauth";
import { AppError, assertConsent, errorResponse, requireOwner } from "@/server/http";
import { enforceRateLimit, RATE_LIMITS } from "@/server/rate-limit";
import { ensureOwner } from "@/server/lifeos";
import { withTelegramUser } from "@/server/owner-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const startSchema = z.object({
  name: z.string().trim().min(1).max(80),
  freeTierConfirmed: z.literal(true),
}).strict();

const noStore = { "Cache-Control": "no-store" };

/** Starts a PKCE login for the verified Telegram user; the Mini App opens `authUrl` in the external browser. */
export async function POST(request: Request): Promise<Response> {
  try {
    const user = requireOwner(request);
    await enforceRateLimit(RATE_LIMITS.aiProviders, user.id);
    let payload: unknown;
    try { payload = JSON.parse(await request.text()); } catch { throw new AppError(400, "Некорректный запрос."); }
    const input = startSchema.parse(payload);
    return await withTelegramUser(String(user.id), async () => {
      const owner = await ensureOwner();
      assertConsent(owner);
      return Response.json(await startOpenRouterOAuth(owner.id, input.name), { headers: noStore });
    });
  } catch (error) {
    const response = errorResponse(error);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}

/** Polled by the Mini App while the user is in the browser. */
export async function GET(request: Request): Promise<Response> {
  try {
    const user = requireOwner(request);
    await enforceRateLimit(RATE_LIMITS.aiProviders, user.id);
    const id = z.string().uuid().safeParse(new URL(request.url).searchParams.get("id"));
    if (!id.success) throw new AppError(400, "Некорректный вход.");
    return await withTelegramUser(String(user.id), async () => {
      const owner = await ensureOwner();
      assertConsent(owner);
      return Response.json(await getOpenRouterOAuthStatus(owner.id, id.data), { headers: noStore });
    });
  } catch (error) {
    const response = errorResponse(error);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
