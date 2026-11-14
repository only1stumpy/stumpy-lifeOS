/** Build-time app version and changelog history, injected by next.config.ts. */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";

export type Release = { version: string; notes: string[] };

export const RELEASE_HISTORY: Release[] = (() => {
  try {
    const parsed: unknown = JSON.parse(process.env.NEXT_PUBLIC_RELEASE_HISTORY ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is Release => typeof item?.version === "string" && Array.isArray(item?.notes));
  } catch {
    return [];
  }
})();

/** Numeric comparison of MAJOR.MINOR.PATCH versions. */
export function compareVersions(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

/**
 * Releases newer than the last version the user saw, newest first, up to the current build.
 * Without a remembered version only the current release is shown, not the whole history.
 */
export function releasesSince(lastSeen: string | null, history: readonly Release[] = RELEASE_HISTORY, current = APP_VERSION): Release[] {
  const upToCurrent = history.filter((release) => compareVersions(release.version, current) <= 0 && release.notes.length);
  if (!lastSeen) return upToCurrent.slice(0, 1);
  return upToCurrent.filter((release) => compareVersions(release.version, lastSeen) > 0);
}
