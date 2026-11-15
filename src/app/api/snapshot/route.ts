import { requireOwner, errorResponse } from "@/server/http";
import { enforceRateLimit, RATE_LIMITS } from "@/server/rate-limit";
import { loadSnapshot } from "@/server/lifeos";
import { withTelegramUser } from "@/server/owner-context";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const user = requireOwner(request);
    await enforceRateLimit(RATE_LIMITS.snapshot, user.id);
    return await withTelegramUser(String(user.id), async () => Response.json(await loadSnapshot(new URL(request.url).searchParams.get("date") ?? undefined), { headers: { "Cache-Control": "no-store" } }));
  } catch (error) { return errorResponse(error); }
}
