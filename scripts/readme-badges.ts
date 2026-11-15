/** Badges and the version mention in README.md are generated from package.json, so they cannot drift. */
export type PackageMeta = { version: string; license?: string; engines?: { node?: string } };

export const BADGES_START = "<!-- badges:start -->";
export const BADGES_END = "<!-- badges:end -->";
export const VERSION_START = "<!-- version -->";
export const VERSION_END = "<!-- /version -->";

/** shields.io static badge parts: dashes and underscores are doubled, spaces become underscores. */
function part(value: string): string {
  return value.replace(/-/g, "--").replace(/_/g, "__").replace(/ /g, "_");
}

function stage(version: string): { text: string; color: string } {
  if (/-rc\b/i.test(version)) return { text: "релиз-кандидат", color: "yellow" };
  if (version.startsWith("0.")) return { text: "бета", color: "orange" };
  return { text: "стабильная", color: "green" };
}

export function renderBadges(pkg: PackageMeta): string {
  const lines: string[] = [];
  lines.push(`![Версия](https://img.shields.io/badge/версия-${part(pkg.version)}-8b1e3f)`);
  const { text, color } = stage(pkg.version);
  lines.push(`![Статус](https://img.shields.io/badge/статус-${part(text)}-${color})`);
  if (pkg.engines?.node) lines.push(`![Node.js](https://img.shields.io/badge/node-${encodeURIComponent(part(pkg.engines.node))}-339933)`);
  if (pkg.license) lines.push(`![Лицензия](https://img.shields.io/badge/лицензия-${part(pkg.license.replace(/-(only|or-later)$/, ""))}-blue)`);
  return lines.join("\n");
}

function replaceBetween(text: string, start: string, end: string, body: string): string {
  const from = text.indexOf(start);
  const to = text.indexOf(end);
  if (from < 0 || to < from) throw new Error(`README.md: не найдены маркеры ${start} … ${end}`);
  return text.slice(0, from + start.length) + body + text.slice(to);
}

/** Returns README text with the badge block and the inline version replaced from package.json. */
export function applyReadme(readme: string, pkg: PackageMeta): string {
  const withBadges = replaceBetween(readme, BADGES_START, BADGES_END, `\n${renderBadges(pkg)}\n`);
  return replaceBetween(withBadges, VERSION_START, VERSION_END, `\`${pkg.version}\``);
}
