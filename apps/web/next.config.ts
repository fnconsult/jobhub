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
  // The Unicode fonts a PDF export embeds are read from node_modules at run time (src/export/fonts.ts).
  // `npm run build` checks they all made it into the standalone output (scripts/check-standalone-fonts.ts).
  outputFileTracingIncludes: {
    "/api/**": [
      "../../node_modules/dejavu-fonts-ttf/ttf/DejaVu{Sans,Serif}{,-Bold}.ttf",
      "../../node_modules/@fontsource/noto-sans-{sc,kr}/files/*-{400,700}-normal.woff",
      "../../node_modules/@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-{400,700}-normal.woff",
      "../../node_modules/@fontsource/noto-sans-thai/files/noto-sans-thai-thai-{400,700}-normal.woff",
      "../../node_modules/@fontsource/noto-emoji/files/noto-emoji-emoji-400-normal.woff",
    ],
  },
};

export default nextConfig;
