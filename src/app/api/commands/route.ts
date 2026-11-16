import { requireOwner, errorResponse, AppError } from "@/server/http";
import { enforceRateLimit, RATE_LIMITS } from "@/server/rate-limit";
import { commandSchema } from "@/domain/commands";
import { executeCommand, loadSnapshot } from "@/server/lifeos";
import { AIAnalysisError } from "@/server/ai/types";
import { withTelegramUser } from "@/server/owner-context";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const user = requireOwner(request);
    await enforceRateLimit(RATE_LIMITS.commands, user.id);
    if (Number(request.headers.get("content-length") ?? 0) > 64000) throw new AppError(413, "Слишком большой запрос.");
    const raw = await request.text();
    if (raw.length > 64000) throw new AppError(413, "Слишком большой запрос.");
    let data: unknown;
    try { data = JSON.parse(raw); } catch { throw new AppError(400, "Некорректный запрос."); }
    return await withTelegramUser(String(user.id), async () => {
      const command = commandSchema.parse(data);
      await executeCommand(command);
      // After deleting the account there is nothing to load: loading would silently create a new empty profile.
      if (command.type === "account.delete") return Response.json({ deleted: true }, { headers: { "Cache-Control": "no-store" } });
      // The change is already committed: a failed read must not look like a failed command, or the form is retried and saves twice.
      try {
        return Response.json(await loadSnapshot(), { headers: { "Cache-Control": "no-store" } });
      } catch {
        return Response.json({ committed: true }, { headers: { "Cache-Control": "no-store" } });
      }
    });
  } catch (error) {
    if (error instanceof AIAnalysisError) return Response.json({ error: error.message }, { status: 503 });
    return errorResponse(error);
  }
}
