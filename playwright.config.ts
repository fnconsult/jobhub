import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { e2eExtensionDir, unpackedExtensionId } from "./e2e/support/extension";
import { webPort as e2eWebPort } from "./e2e/support/ports";

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
// is Mistral's API, which serves every AI task (e2e/support/fake-mistral.mjs),
// and so are the French company register and Perplexity's web search behind
// Company Dossiers (e2e/support/fake-company-sources.mjs).
// Stripe is a fake HTTP API (apps/web/src/billing/fake-stripe.ts) on
// E2E_STRIPE_URL; webhooks are signed with its test secret. ADMIN_EMAILS names
// the e2e Administrator.
const webPort = e2eWebPort();
const webOrigin = `http://localhost:${webPort}`;
const stripePort = Number(process.env.E2E_STRIPE_PORT ?? webPort + 9000);

// Set once in the main process; Playwright workers inherit them.
process.env.E2E_WEB_PORT = String(webPort);
process.env.E2E_WEB_ORIGIN = webOrigin;
process.env.E2E_STRIPE_PORT = String(stripePort);
process.env.E2E_STRIPE_URL = `http://127.0.0.1:${stripePort}`;
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
      testMatch: /(web|auth|profiles|master-cv|match-score|ats-score|coach|billing|applications|company-dossier|export|tailored-documents)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: webOrigin, locale: "en-US" },
    },
    { name: "extension", testMatch: /extension\.spec\.ts/, use: { baseURL: webOrigin } },
    { name: "stack", testMatch: /stack\.spec\.ts/ },
    { name: "repo", testMatch: /(repo|migrate|agent-runs)\.spec\.ts/ },
    { name: "ai", testMatch: /ai\.spec\.ts/ },
    // The worker's background jobs, run by `tsx src/main.ts` against the web server's database.
    // One spec at a time: each starts its own worker on the same queue, which would take the other's jobs.
    { name: "worker", testMatch: /job-(discovery|search)\.spec\.ts/, workers: 1 },
    { name: "root-env", testMatch: /root-env\.spec\.ts/ },
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
        `--import=${path.resolve("e2e/support/fake-company-sources.mjs")}`,
      ].join(" "),
      STRIPE_SECRET_KEY: "sk_test_fake",
      STRIPE_WEBHOOK_SECRET: "whsec_test_fake",
      STRIPE_PRICE_STANDARD: "price_standard_monthly",
      STRIPE_PRICE_PREMIUM: "price_premium_monthly",
      STRIPE_API_URL: process.env.E2E_STRIPE_URL,
      ADMIN_EMAILS: "back-office@e2e.jobbbox.test",
    },
  },
});
