export const dynamic = "force-dynamic";

/** Liveness probe for uptime monitors: no secrets and no database access. */
export function GET(): Response {
  return Response.json({ status: "ok", version: process.env.NEXT_PUBLIC_APP_VERSION ?? "unknown" }, { headers: { "Cache-Control": "no-store" } });
}
