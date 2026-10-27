import { requireOwner, errorResponse } from "@/server/http";
import { loadSnapshot } from "@/server/lifeos";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    requireOwner(request);
    return Response.json(await loadSnapshot(new URL(request.url).searchParams.get("date") ?? undefined), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

