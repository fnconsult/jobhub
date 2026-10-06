import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { e2eExtensionDir, unpackedExtensionId } from "./e2e/support/extension";

// End-to-end suite (`npm run test:e2e`). Exercises each public entry point:
// the built web app over HTTP, the built Chrome extension, the local docker
// compose stack (Postgres + worker), the repo's CLI/CI tooling and the AI layer
// (driven in a separate process through its env-configured entry point).
// Run `npm run build` first: the web and extension projects use the build output.
//
// The web server gets its own throwaway database (E2E_DATABASE_URL, derived from
// DATABASE_URL), migrated with `npm run db:migrate` and dropped afterwards.
// Sign-in emails land in E2E_SERVER_LOG (MAIL_TRANSPORT=console), and Google's
// token endpoint is faked inside the server (e2e/support/fake-google.mjs), and so
// is Mistral's API, which serves every AI task (e2e/support/fake-mistral.mjs).
const webPort = Number(process.env.E2E_WEB_PORT ?? 3001);
const webOrigin = `http://localhost:${webPort}`;

// Set once in the main process; Playwright workers inherit them.
process.env.E2E_WEB_PORT = String(webPort);
process.env.E2E_WEB_ORIGIN = webOrigin;
process.env.E2E_SERVER_LOG ??= path.join(os.tmpdir(), `jobhub-e2e-${webPort}`, "server.log");
if (!process.env.E2E_DATABASE_URL) {
  const url = new URL(process.env.DATABASE_URL ?? "postgres://jobhub:jobhub@localhost:5433/jobhub");
  url.pathname = `/jobhub_e2e_${webPort}`;
  process.env.E2E_DATABASE_URL = url.toString();
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  reporter: [["list"]],
  timeout: 60_000,
  globalTeardown: "./e2e/support/global-teardown.ts",
  use: { trace: "retain-on-failure" },
  projects: [
    {
      name: "web",
      testMatch: /(web|auth|profiles)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: webOrigin, locale: "en-US" },
    },
    { name: "extension", testMatch: /extension\.spec\.ts/, use: { baseURL: webOrigin } },
    { name: "stack", testMatch: /stack\.spec\.ts/ },
    { name: "repo", testMatch: /(repo|migrate|agent-runs)\.spec\.ts/ },
    { name: "ai", testMatch: /ai\.spec\.ts/ },
  ],
  webServer: {
    command: "node e2e/support/web-server.mjs",
    url: `${webOrigin}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NEXT_TELEMETRY_DISABLED: "1",
      // Candidate accounts in a local production build: sign-in links go to the server log.
      APP_URL: webOrigin,
      AUTH_SECRET: process.env.AUTH_SECRET ?? "e2e-only-secret-e2e-only-secret-e2e-only",
      MAIL_TRANSPORT: "console",
      GOOGLE_CLIENT_ID: "e2e-client.apps.googleusercontent.com", // see e2e/auth.spec.ts
      GOOGLE_CLIENT_SECRET: "e2e-client-secret",
      EXTENSION_ORIGINS: `chrome-extension://${unpackedExtensionId(e2eExtensionDir)}`,
      // AI layer (ADR-0007): every text task on Mistral (EU), faked in-process by e2e/support/fake-mistral.mjs.
      AI_SCORING_PROVIDER: "mistral",
      AI_WRITING_PROVIDER: "mistral",
      AI_COACHING_PROVIDER: "mistral",
      AI_CV_PARSING_PROVIDER: "mistral",
      AI_OFFER_ANALYSIS_PROVIDER: "mistral",
      MISTRAL_API_KEY: "e2e-mistral-key",
      PERPLEXITY_API_KEY: "e2e-perplexity-key",
      NODE_OPTIONS: [
        `--import=${path.resolve("e2e/support/fake-google.mjs")}`,
        `--import=${path.resolve("e2e/support/fake-mistral.mjs")}`,
      ].join(" "),
    },
  },
});
