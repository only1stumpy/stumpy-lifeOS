import { getGeminiQuotaSnapshot } from "@/server/ai/quotas";
import { errorResponse, requireConfiguredOwner } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    requireConfiguredOwner(request);
    return Response.json(await getGeminiQuotaSnapshot(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const response = errorResponse(error);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
