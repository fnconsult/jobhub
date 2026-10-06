import { defineConfig, devices } from "@playwright/test";

// End-to-end suite (`npm run test:e2e`). Exercises each public entry point:
// the built web app over HTTP, the built Chrome extension, the local docker
// compose stack (Postgres + worker), the repo's CLI/CI tooling and the AI layer
// (driven in a separate process through its env-configured entry point).
// Run `npm run build` first: the web and extension projects use the build output.
const webPort = Number(process.env.E2E_WEB_PORT ?? 3001);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  reporter: [["list"]],
  timeout: 60_000,
  use: { trace: "retain-on-failure" },
  projects: [
    {
      name: "web",
      testMatch: /web\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${webPort}`, locale: "en-US" },
    },
    { name: "extension", testMatch: /extension\.spec\.ts/ },
    { name: "stack", testMatch: /stack\.spec\.ts/ },
    { name: "repo", testMatch: /repo\.spec\.ts/ },
    { name: "ai", testMatch: /ai\.spec\.ts/ },
  ],
  webServer: {
    command: `npx next start apps/web -p ${webPort}`,
    url: `http://localhost:${webPort}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      NEXT_TELEMETRY_DISABLED: "1",
      // Candidate accounts in a local production build: sign-in links go to the server log.
      APP_URL: `http://localhost:${webPort}`,
      AUTH_SECRET: process.env.AUTH_SECRET ?? "e2e-only-secret-e2e-only-secret-e2e-only",
      MAIL_TRANSPORT: "console",
    },
  },
});
