import { getDb } from "@/db/client";
import { createBackup, type BackupDatabase } from "@/server/backup";
import { errorResponse, requireOwner } from "@/server/http";
import { sendExportToChat } from "@/server/telegram/bot";
import { enforceRateLimit, RATE_LIMITS } from "@/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = requireOwner(request);
    await enforceRateLimit(RATE_LIMITS.export, user.id);
    const backup = await createBackup(getDb() as unknown as BackupDatabase, String(user.id));
    const date = new Date().toISOString().slice(0, 10);
    return new Response(JSON.stringify(backup), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="lifeos-backup-${date}.json"`,
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Sends the export into the user\'s Telegram chat; file downloads are unreliable inside the Telegram WebView. */
export async function POST(request: Request) {
  try {
    const user = requireOwner(request);
    await sendExportToChat(String(user.id));
    return Response.json({ sent: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
