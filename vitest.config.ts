import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["{packages,apps}/*/src/**/*.test.{ts,tsx}", "docs/prototypes/**/*.test.ts", "e2e/support/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
