import { completeOpenRouterOAuth, miniAppReturnLink } from "@/server/ai/openrouter-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** Redirect target of OpenRouter in the external browser: no Telegram session here, `state` is the proof. */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  let outcome: Awaited<ReturnType<typeof completeOpenRouterOAuth>>;
  try {
    outcome = await completeOpenRouterOAuth({ state: params.get("state"), code: params.get("code"), error: params.get("error") });
  } catch (error) {
    console.error("LifeOS OpenRouter OAuth callback failed", error instanceof Error ? error.name : "unknown");
    outcome = { ok: false, message: "Не удалось завершить вход. Вернись в Mini App и повтори попытку или вставь ключ вручную." };
  }
  const title = outcome.ok ? "Готово" : "Вход не завершён";
  const text = outcome.ok ? "OpenRouter подключён. Окно закроется само; если нет, нажми кнопку ниже." : outcome.message;
  const returnUrl = await miniAppReturnLink().catch(() => null);
  const back = returnUrl ? `<p><a class="back" href="${escapeHtml(returnUrl)}" onclick="return lifeosBack()">Закрыть и вернуться</a></p>` : "";
  // Closes the in-app browser where window.close works, otherwise opens the deep link; after a success it runs by itself.
  const script = returnUrl
    ? `<script>function lifeosBack(){try{window.close()}catch(e){}setTimeout(function(){location.href=${JSON.stringify(returnUrl).replace(/</g, "\\u003c")}},300);return false}${outcome.ok ? "setTimeout(lifeosBack,500);" : ""}</script>`
    : "";
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${title}</title><style>body{font:16px/1.5 system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#faf7f5;color:#241418}main{max-width:26rem;padding:24px}h1{font-size:1.4rem;margin:0 0 8px}a.back{display:block;box-sizing:border-box;width:100%;padding:16px 20px;border-radius:16px;background:#7a1f33;color:#fff;font-weight:600;text-align:center;text-decoration:none}</style></head><body><main><h1>${title}</h1><p>${escapeHtml(text)}</p>${back}</main>${script}</body></html>`;
  return new Response(html, {
    status: outcome.ok ? 200 : 400,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" },
  });
}
