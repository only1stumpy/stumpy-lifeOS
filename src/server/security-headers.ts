/**
 * Response headers applied to every route. The Content-Security-Policy is intentionally limited to
 * directives that do not depend on inline scripts: a full script-src policy needs per-request nonces
 * and is tracked in docs/release-plan.md.
 */
const TELEGRAM_FRAME_ANCESTORS = "'self' https://web.telegram.org https://*.telegram.org";

export function securityHeaders(): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: `frame-ancestors ${TELEGRAM_FRAME_ANCESTORS}; base-uri 'self'; object-src 'none'; form-action 'self'` },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  ];
}
