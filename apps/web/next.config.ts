import type { NextConfig } from "next";
// A package specifier, not "./src/...": Next.js resolves relative imports in this file
// against the working directory, which is the repo root for `next start apps/web`.
import { loadRootEnv } from "@jobhub/web/root-env";

// Next.js only reads `.env*` from apps/web; the README's `.env` lives at the repo root.
loadRootEnv();

const nextConfig: NextConfig = {
  // Self-contained server bundle, deployable as a container in an EU region (ADR-0007).
  output: "standalone",
  transpilePackages: ["@jobhub/shared", "@jobhub/ai"],
};

export default nextConfig;
