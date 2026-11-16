import { after } from "next/server";
import { z } from "zod";
import { AppError, errorResponse } from "@/server/http";
import { requireAdmin } from "@/server/admin/config";
import { requeueFailedUpdates, sendTestAlert } from "@/server/admin/actions";
import { processStoredTelegramUpdate } from "@/server/telegram/updates";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const bodySchema = z.object({ action: z.enum(["retry_failed", "test_alert"]) });

/** The only admin actions: retry failed Telegram updates and send a test alert. Nothing here changes user data directly. */
export async function POST(request: Request): Promise<Response> {
  try {
    await requireAdmin(request);
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError(400, "Неизвестное действие.");
    if (parsed.data.action === "test_alert") return Response.json({ delivered: await sendTestAlert() });
    const ids = await requeueFailedUpdates();
    after(async () => {
      for (const id of ids) await processStoredTelegramUpdate(id);
    });
    return Response.json({ requeued: ids.length });
  } catch (error) {
    return errorResponse(error);
  }
}
