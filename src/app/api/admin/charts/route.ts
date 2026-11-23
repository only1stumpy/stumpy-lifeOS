import { errorResponse } from "@/server/http";
import { requireAdmin } from "@/server/admin/config";
import { loadCharts } from "@/server/admin/charts";
import { loadUptime } from "@/server/admin/uptime";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

/** Time series and uptime history: counts per hour/day only, no identifiers. */
export async function GET(request: Request): Promise<Response> {
  try {
    await requireAdmin(request);
    const [charts, uptime] = await Promise.all([loadCharts(), loadUptime()]);
    return Response.json({ charts, uptime }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
