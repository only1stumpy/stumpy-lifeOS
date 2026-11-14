import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";

const { version } = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { version: string };

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: { useTypeScriptCli: false },
  env: { NEXT_PUBLIC_APP_VERSION: version },
};

export default nextConfig;
