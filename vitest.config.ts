import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The web app's tsconfig preserves JSX for Next.js; its component tests (.test.tsx) need it compiled.
  oxc: { jsx: { runtime: "automatic" } },
  // The web app's own import alias (apps/web/tsconfig.json), for its component tests.
  resolve: { alias: [{ find: /^@\//, replacement: fileURLToPath(new URL("./apps/web/src/", import.meta.url)) }] },
  test: {
    include: ["{packages,apps}/*/src/**/*.test.{ts,tsx}", "docs/prototypes/**/*.test.ts", "e2e/support/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
