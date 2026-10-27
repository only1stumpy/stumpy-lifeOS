import { requireOwner, errorResponse, AppError } from "@/server/http";
import { commandSchema } from "@/domain/commands";
import { executeCommand, loadSnapshot } from "@/server/lifeos";
import { AIAnalysisError } from "@/server/ai/types";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    requireOwner(request);
    if (Number(request.headers.get("content-length") ?? 0) > 64000) throw new AppError(413, "Слишком большой запрос.");
    const raw = await request.text();
    if (raw.length > 64000) throw new AppError(413, "Слишком большой запрос.");
    let data: unknown;
    try { data = JSON.parse(raw); } catch { throw new AppError(400, "Некорректный запрос."); }
    await executeCommand(commandSchema.parse(data));
    return Response.json(await loadSnapshot(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AIAnalysisError) return Response.json({ error: error.message }, { status: 503 });
    return errorResponse(error);
  }
}

