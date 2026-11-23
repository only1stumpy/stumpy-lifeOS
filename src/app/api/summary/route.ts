import { z } from "zod";
import { requireOwner, errorResponse, assertConsent } from "@/server/http";
import { withTelegramUser } from "@/server/owner-context";
import { ensureOwner } from "@/server/lifeos";
import { enforceRateLimit, RATE_LIMITS } from "@/server/rate-limit";
import { loadPeriodReport } from "@/server/period-report";
import { getSummaryAdvice } from "@/server/ai/summary-advice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const querySchema = z.object({
  period: z.enum(["day", "week", "month"]),
  start: z.string(),
});

async function respond(request: Request, includeAdvice = false) {
  try {
    const user = requireOwner(request);
    await enforceRateLimit(RATE_LIMITS.snapshot, user.id);
    const params = new URL(request.url).searchParams;
    const parsed = querySchema.safeParse({ period: params.get("period"), start: params.get("start") });
    if (!parsed.success) return Response.json({ error: "Некорректный период сводки." }, { status: 400 });
    return await withTelegramUser(String(user.id), async () => {
      const owner = await ensureOwner();
      assertConsent(owner);
      const report = await loadPeriodReport(parsed.data.period, parsed.data.start);
      const advice = includeAdvice ? await getSummaryAdvice(owner.id, report) : { advice: null, adviceError: null };
      return Response.json({ report, ...advice }, { headers: { "Cache-Control": "no-store" } });
    });
  } catch (error) { return errorResponse(error); }
}

export async function GET(request: Request) { return respond(request); }
export async function POST(request: Request) { return respond(request, true); }
