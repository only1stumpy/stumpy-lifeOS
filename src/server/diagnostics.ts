/**
 * Safe description of an error for logs and alerts: the class and a short code only.
 * Messages, payloads, URLs and keys are never included.
 */
export type ErrorInfo = { name: string; code?: string };

const SAFE_CODE = /^[A-Za-z0-9_.:-]{1,40}$/;

export function describeError(error: unknown): ErrorInfo {
  if (!(error instanceof Error)) return { name: "unknown" };
  const record = error as unknown as Record<string, unknown>;
  // AppError.status, grammY error_code, provider failure kind, AI analysis code.
  for (const field of ["status", "error_code", "kind", "code"]) {
    const value = record[field];
    if ((typeof value === "number" && Number.isFinite(value)) || (typeof value === "string" && SAFE_CODE.test(value))) {
      return { name: error.name, code: String(value) };
    }
  }
  return { name: error.name };
}

export function formatErrorInfo(info: ErrorInfo): string {
  return info.code ? `${info.name}:${info.code}` : info.name;
}

/** Telegram refuses delivery because the user blocked the bot or the chat is gone: an expected state, not a service failure. */
export function isUndeliverable(error: unknown): boolean {
  const code = Number((error as { error_code?: unknown } | null)?.error_code);
  return code === 403 || code === 400;
}
