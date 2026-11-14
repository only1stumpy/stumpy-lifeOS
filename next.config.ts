import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";

const { version } = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { version: string };

/** Bullet points of the newest CHANGELOG.md section, shown once per version in the Mini App. */
function latestReleaseNotes(): string[] {
  const lines = readFileSync(join(process.cwd(), "CHANGELOG.md"), "utf8").split("\n");
  const start = lines.findIndex((line) => /^## \d+\.\d+\.\d+/.test(line));
  if (start < 0) return [];
  const notes: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    if (line.startsWith("- ")) notes.push(line.slice(2).trim());
  }
  return notes;
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: { useTypeScriptCli: false },
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_RELEASE_NOTES: JSON.stringify(latestReleaseNotes()),
  },
};

export default nextConfig;
