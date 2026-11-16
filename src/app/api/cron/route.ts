import { timingSafeEqual } from "node:crypto";
import { AppError } from "@/server/http";
import { warnAboutWeakSecretsOnce } from "@/server/security-config";
import { runMonitoredCron } from "@/server/admin/monitoring";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return runCron(request);
}

export async function POST(request: Request): Promise<Response> {
  return runCron(request);
}

async function runCron(request: Request): Promise<Response> {
  try {
    warnAboutWeakSecretsOnce();
    const secret = process.env.CRON_SECRET;
    if (!secret) throw new AppError(503, "Планировщик ещё не настроен.");
    const authorization = request.headers.get("authorization") ?? "";
    if (!constantTimeEqual(authorization, `Bearer ${secret}`)) {
      throw new AppError(401, "Недействительный запрос планировщика.");
    }

    const { sent, failed, skippedOwners } = await runMonitoredCron();
    // A run with failures is not a 200: the external scheduler must see it too.
    return Response.json({ ok: failed === 0, sent, failed, ...(skippedOwners ? { skippedOwners } : {}) }, { status: failed === 0 ? 200 : 500 });
  } catch (error) {
    if (error instanceof AppError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "Не удалось выполнить плановые задачи." }, { status: 503 });
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
