import { z } from "zod";
import { AppError, errorResponse, requireOwner } from "@/server/http";
import { ensureOwner } from "@/server/lifeos";
import { withTelegramUser } from "@/server/owner-context";
import {
  deleteAiProviderProfile,
  listAiProviderProfiles,
  saveAiProviderProfile,
} from "@/server/ai/provider-profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const profileInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(80),
  endpoint: z.string().trim().min(1).max(500),
  model: z.string().trim().min(1).max(160),
  apiKey: z.string().trim().min(1).max(8_192).optional(),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
}).strict();

export async function GET(request: Request): Promise<Response> {
  try {
    const user = requireOwner(request);
    return await withTelegramUser(String(user.id), async () => {
      const owner = await ensureOwner();
      const profiles = await listAiProviderProfiles(owner.id);
      const legacyQuotaAvailable = Boolean(process.env.TELEGRAM_OWNER_ID && String(user.id) === process.env.TELEGRAM_OWNER_ID.trim());
      return Response.json({ profiles, legacyQuotaAvailable }, { headers: { "Cache-Control": "no-store" } });
    });
  } catch (error) {
    const response = errorResponse(error);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const user = requireOwner(request);
    if (Number(request.headers.get("content-length") ?? 0) > 16_384) throw new AppError(413, "Слишком большой запрос.");
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > 16_384) throw new AppError(413, "Слишком большой запрос.");
    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { throw new AppError(400, "Некорректный запрос."); }
    const input = profileInput.parse(payload);

    return await withTelegramUser(String(user.id), async () => {
      const owner = await ensureOwner();
      const profile = await saveAiProviderProfile(owner.id, input);
      return Response.json({ profile }, { headers: { "Cache-Control": "no-store" } });
    });
  } catch (error) {
    const response = errorResponse(error);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const user = requireOwner(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!id || !z.string().uuid().safeParse(id).success) throw new AppError(400, "Некорректный профиль провайдера.");

    return await withTelegramUser(String(user.id), async () => {
      const owner = await ensureOwner();
      await deleteAiProviderProfile(owner.id, id);
      return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    });
  } catch (error) {
    const response = errorResponse(error);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
