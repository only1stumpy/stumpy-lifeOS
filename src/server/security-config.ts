/** Minimum length of deployment secrets that gate machine-to-machine endpoints. */
export const MIN_SECRET_LENGTH = 32;

const SECRET_NAMES = ["CRON_SECRET", "TELEGRAM_WEBHOOK_SECRET"] as const;

/** Human-readable problems with the configured secrets; never includes the secret values. */
export function weakSecretWarnings(env: Record<string, string | undefined> = process.env): string[] {
  const warnings: string[] = [];
  for (const name of SECRET_NAMES) {
    const value = env[name];
    if (!value) continue;
    if (value.length < MIN_SECRET_LENGTH) warnings.push(`${name} короче ${MIN_SECRET_LENGTH} символов`);
    else if (new Set(value).size < 8) warnings.push(`${name} содержит слишком мало разных символов`);
  }
  return warnings;
}

let warned = false;

/** Logs weak-secret warnings once per server process so Vercel logs show them without flooding. */
export function warnAboutWeakSecretsOnce(env: Record<string, string | undefined> = process.env): void {
  if (warned) return;
  warned = true;
  for (const message of weakSecretWarnings(env)) console.warn(`LifeOS security: ${message}.`);
}
