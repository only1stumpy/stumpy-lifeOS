import { errorResponse } from "@/server/http";
import { requireAdmin } from "@/server/admin/config";
import { loadOverview } from "@/server/admin/overview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    await requireAdmin(request);
    return Response.json(await loadOverview(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
