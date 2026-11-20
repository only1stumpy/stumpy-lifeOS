import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";
import { parseChangelog } from "./src/domain/changelog";
import { securityHeaders } from "./src/server/security-headers";

const { version } = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { version: string };

/** Every CHANGELOG.md release with its bullet points, newest first; the Mini App shows what a user has missed. */
function releaseHistory() {
  return parseChangelog(readFileSync(join(process.cwd(), "CHANGELOG.md"), "utf8"));
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: { useTypeScriptCli: false },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders() },
      // Fonts never change under the same file name, so browsers can keep them for a year.
      { source: "/fonts/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
    ];
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_RELEASE_HISTORY: JSON.stringify(releaseHistory()),
  },
};

export default nextConfig;
