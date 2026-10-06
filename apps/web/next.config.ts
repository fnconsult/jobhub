import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle, deployable as a container in an EU region (ADR-0007).
  output: "standalone",
  transpilePackages: ["@jobhub/shared"],
};

export default nextConfig;
