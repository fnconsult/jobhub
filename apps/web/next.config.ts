import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle, deployable as a container in an EU region (ADR-0007).
  output: "standalone",
  transpilePackages: ["@jobhub/shared", "@jobhub/ai"],
  // The Unicode fonts a PDF export embeds are read from node_modules at run time (src/export/fonts.ts).
  outputFileTracingIncludes: {
    "/api/**": [
      "../../node_modules/dejavu-fonts-ttf/ttf/DejaVu{Sans,Serif}{,-Bold}.ttf",
      "../../node_modules/@fontsource/noto-sans-{sc,kr}/files/*-{400,700}-normal.woff",
      "../../node_modules/@fontsource/noto-emoji/files/noto-emoji-emoji-400-normal.woff",
    ],
  },
};

export default nextConfig;
