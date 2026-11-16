import { timingSafeEqual } from "node:crypto";
import { checkReadiness } from "@/server/readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Readiness probe behind CRON_SECRET: the database answers and the newest migration recorded in
 * drizzle.__drizzle_migrations is the one the deployed code expects (the last entry of the journal).
 */
export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return reply(503, { status: "unconfigured" });
  if (!constantTimeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) return reply(401, { status: "unauthorized" });

  const readiness = await checkReadiness();
  return reply(readiness.status === "ready" ? 200 : 503, readiness);
}

function reply(status: number, body: object): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
