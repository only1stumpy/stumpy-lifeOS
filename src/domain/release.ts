/** Build-time app version and the newest changelog bullets, injected by next.config.ts. */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";

export const RELEASE_NOTES: string[] = (() => {
  try {
    const parsed: unknown = JSON.parse(process.env.NEXT_PUBLIC_RELEASE_NOTES ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
})();
