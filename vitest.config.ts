import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  // The web app's tsconfig preserves JSX for Next.js; its component tests (.test.tsx) need it compiled.
  oxc: { jsx: { runtime: "automatic" } },
  // The web app's own import alias (apps/web/tsconfig.json), for its component tests.
  resolve: { alias: [{ find: /^@\//, replacement: fileURLToPath(new URL("./apps/web/src/", import.meta.url)) }] },
  test: {
    include: ["{packages,apps}/*/src/**/*.test.{ts,tsx}", "docs/prototypes/**/*.test.ts", "e2e/support/**/*.test.ts", "scripts/**/*.test.ts"],
    // The native app runs its tests in Jest, on React Native's preset (apps/mobile/jest.config.js, ADR-0076).
    exclude: [...configDefaults.exclude, "apps/mobile/**"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
