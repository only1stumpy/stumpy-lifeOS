/** Joins class names, skipping empty ones. The kit passes variants through data attributes, so this is all it needs. */
export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}
