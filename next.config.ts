import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";
import { securityHeaders } from "./src/server/security-headers";

const { version } = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { version: string };

/** Every CHANGELOG.md release with its bullet points, newest first; the Mini App shows what a user has missed. */
function releaseHistory(): { version: string; notes: string[] }[] {
  const releases: { version: string; notes: string[] }[] = [];
  for (const line of readFileSync(join(process.cwd(), "CHANGELOG.md"), "utf8").split("\n")) {
    const heading = /^## (\d+\.\d+\.\d+)/.exec(line);
    if (heading) releases.push({ version: heading[1], notes: [] });
    else if (line.startsWith("- ") && releases.length) releases[releases.length - 1].notes.push(line.slice(2).trim());
  }
  return releases;
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: { useTypeScriptCli: false },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders() }];
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_RELEASE_HISTORY: JSON.stringify(releaseHistory()),
  },
};

export default nextConfig;
