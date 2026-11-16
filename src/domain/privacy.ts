/** Current version of docs/privacy-policy.md; bump it when the policy changes so users accept it again. */
export const PRIVACY_POLICY_VERSION = "2.0";

/** Version of the separate consent to process health data (weight, nutrition, workouts). Bump it when that text changes. */
export const HEALTH_CONSENT_VERSION = "1.0";

export const PRIVACY_POLICY_URL = "https://github.com/only1stumpy/stumpy-lifeOS/blob/main/docs/privacy-policy.md";
export const TERMS_URL = "https://github.com/only1stumpy/stumpy-lifeOS/blob/main/docs/terms.md";
/** AGPL-3.0 section 13: users of the network service are offered the corresponding source. */
export const SOURCE_CODE_URL = "https://github.com/only1stumpy/stumpy-lifeOS";

/** The word a user types to confirm deleting every piece of their data. */
export const DELETE_CONFIRMATION_WORD = "УДАЛИТЬ" as const;

/** Commands that stay available without current consent: giving or withdrawing it, and the user's own data rights. */
export const CONSENT_EXEMPT_COMMANDS: ReadonlySet<string> = new Set(["privacy.accept", "privacy.health.accept", "privacy.health.revoke", "account.delete"]);

export type ConsentState = "ok" | "policy" | "health";

/** Which consent is still missing: the policy (with 18+ and terms) comes first, then the health-data one. */
export function consentState(owner: { privacyPolicyVersion: string | null; healthConsentVersion: string | null }): ConsentState {
  if (owner.privacyPolicyVersion !== PRIVACY_POLICY_VERSION) return "policy";
  if (owner.healthConsentVersion !== HEALTH_CONSENT_VERSION) return "health";
  return "ok";
}
