import { errorResponse } from "@/server/http";
import { requireAdmin } from "@/server/admin/config";
import { getStats } from "@/server/admin/stats";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

/** Aggregates only. They come from a cache refreshed by the cron; the first call after deployment computes them once. */
export async function GET(request: Request): Promise<Response> {
  try {
    await requireAdmin(request);
    return Response.json(await getStats(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
