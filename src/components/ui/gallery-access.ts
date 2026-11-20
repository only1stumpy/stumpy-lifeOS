/** The /ui gallery is a development and Preview tool: hidden only where Vercel says "production". */
export function isGalleryEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.VERCEL_ENV !== "production";
}
