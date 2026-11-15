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

/** SemVer comparison: numeric MAJOR.MINOR.PATCH, and a pre-release (1.0.0-rc.1) sorts before its release (1.0.0). */
export function compareVersions(left: string, right: string): number {
  const [leftCore, leftPre] = splitVersion(left);
  const [rightCore, rightPre] = splitVersion(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftCore[index] ?? 0) - (rightCore[index] ?? 0);
    if (difference) return Math.sign(difference);
  }
  if (!leftPre && !rightPre) return 0;
  if (!leftPre) return 1;
  if (!rightPre) return -1;
  const length = Math.max(leftPre.length, rightPre.length);
  for (let index = 0; index < length; index += 1) {
    const a = leftPre[index];
    const b = rightPre[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    const aNumeric = /^\d+$/.test(a);
    const bNumeric = /^\d+$/.test(b);
    if (aNumeric && bNumeric) { if (Number(a) !== Number(b)) return Math.sign(Number(a) - Number(b)); continue; }
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    if (a !== b) return a < b ? -1 : 1;
  }
  return 0;
}

function splitVersion(version: string): [number[], string[] | null] {
  const [core, ...rest] = version.split("-");
  const pre = rest.join("-");
  return [core.split(".").map(Number), pre ? pre.split(".") : null];
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
