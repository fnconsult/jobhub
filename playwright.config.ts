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
// Company Dossiers (e2e/support/fake-company-sources.mjs), and so is Apollo, the
// contact-data provider behind Enriched Contacts (e2e/support/fake-contact-provider.mjs), and so is
// the careers site of a Job Offer link pasted in the Coach Panel (e2e/support/fake-coach-link-sites.mjs), and so is
// geo.api.gouv.fr, which suggests the Search Criteria's places (e2e/support/fake-geo-api.mjs), and so
// are INSEE and France Travail's ROME open data, the Sectors' and Domains' labels (e2e/support/fake-reference-data.mjs).
// Stripe is a fake HTTP API (apps/web/src/billing/fake-stripe.ts) on
// E2E_STRIPE_URL; webhooks are signed with its test secret. ADMIN_EMAILS names
// the e2e Administrators: permanent super-admins (#204). SECRETS_MASTER_KEYS lets
// the Clés section save Provider Secrets (#208); its specs only change keys the suite's
// server does not use (Lusha's: Enriched Contacts run on Apollo).
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
      testMatch: /(web|ai-activity|database-connections|auth|agenda|account-data|back-office-audit|back-office-roles|back-office-assistant|ai-consumption|provider-secrets|sign-in-providers|profiles|master-cv|match-score|ats-score|coach|coach-ai-disclosure|coach-provenance-line|coach-live-steps|coach-panel-reply|coach-panel-reply|coach-job-offer-link|coach-job-offer-link-provenance|coach-context|coach-memory|coach-playbooks|billing|plans|coupons|applications|company-dossier|enriched-contacts|export|tailored-documents|tailored-cv|tailored-live-steps|human-coaches|eu-ai-consent|appointment-reminders|cv-draft-ai-config|stripe-price-ids|plan-prices|sidebar-layout|application-page|profile-page|coaching-playbooks-back-office|guardrails|eval-runs|tools|platform-settings|text-size-preferences|usage-meter|stripe-checkout|ai-warnings|ai-activity-digest-cards|ai-activity-dossier-cv|coach-help)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: webOrigin, locale: "en-US" },
    },
    { name: "extension", testMatch: /extension\.spec\.ts/, use: { baseURL: webOrigin } },
    { name: "stack", testMatch: /stack\.spec\.ts/ },
    { name: "repo", testMatch: /(repo|migrate|agent-runs|setup-wizards|help-content-package)\.spec\.ts/ },
    { name: "ai", testMatch: /ai\.spec\.ts/ },
    // The coach-knowledge package (#128), loaded in a fresh process through its public entry point.
    { name: "coach-knowledge", testMatch: /coach-knowledge\.spec\.ts/ },
    // The static Notion-like layout prototype (#132), served by the spec itself and driven in Chromium.
    // Needs no web app: run it alone with E2E_NO_WEB_SERVER=1 npx playwright test --project=prototype.
    { name: "prototype", testMatch: /notion-layout-prototype\.spec\.ts/, use: { ...devices["Desktop Chrome"], locale: "fr-FR" } },
    // The worker's background jobs, run by `tsx src/main.ts` against the web server's database.
    // One spec at a time: each starts its own worker on the same queue, which would take the other's jobs.
    { name: "worker", testMatch: /(job-(discovery|search|digest)|job-discovery-budget|job-discovery-listing-pages|job-discovery-ats|job-discovery-france-travail|job-discovery-fantastic-jobs|job-freshness|job-offer-provenance|job-search-provenance-progress|job-search-stop|job-search-metrics|follow-ups|expired-job-offers(-confirmation)?)\.spec\.ts/, workers: 1 },
    // One spec at a time: root-env and worker-env both write the repo-root .env (the compose
    // worker reads it, #64); root-env and dev-servers (the web app's and the extension's dev
    // servers started in either order, #71) both run `npm run dev`, plan-prices-dev (#103) runs
    // `next dev`, and Next.js refuses a second `next dev` in apps/web. Projects run in parallel
    // with each other, so they share this one.
    { name: "root-env", testMatch: /(root-env|worker-env|dev-servers|plan-prices-dev)\.spec\.ts/, workers: 1 },
  ],
  webServer: process.env.E2E_NO_WEB_SERVER ? undefined : {
    command: "node e2e/support/web-server.mjs",
    url: `${webOrigin}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NEXT_TELEMETRY_DISABLED: "1",
      // The e2e environment serves the latest Playbook Versions, validated or not: a production build
      // naming no target serves only Human-validated ones (ADR-0021, #225).
      JOBHUB_TARGET: "e2e",
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
      // An older .env's endpoint (ADR-0033): Paramètres shows it from env, flagged as differing from the default (#298).
      // No task runs on Claude here, and no Claude key is set, so nothing reaches Bedrock.
      ANTHROPIC_ENDPOINT: "bedrock",
      // An editable setting set by env (#299): Paramètres shows it from env, and « Rétablir » falls back to it. Only the web
      // server has it; the specs start their own workers with the suite's environment.
      JOB_DISCOVERY_BUDGET_SECONDS: "75",
      PERPLEXITY_API_KEY: "e2e-perplexity-key",
      NODE_OPTIONS: [
        `--import=${path.resolve("e2e/support/fake-google.mjs")}`,
        `--import=${path.resolve("e2e/support/fake-mistral.mjs")}`,
        `--import=${path.resolve("e2e/support/fake-company-sources.mjs")}`,
        `--import=${path.resolve("e2e/support/fake-contact-provider.mjs")}`,
        `--import=${path.resolve("e2e/support/fake-coach-link-sites.mjs")}`,
        `--import=${path.resolve("e2e/support/fake-geo-api.mjs")}`,
        `--import=${path.resolve("e2e/support/fake-reference-data.mjs")}`,
      ].join(" "),
      STRIPE_SECRET_KEY: "sk_test_fake",
      STRIPE_WEBHOOK_SECRET: "whsec_test_fake",
      STRIPE_PRICE_STANDARD: "price_standard_monthly",
      STRIPE_PRICE_PREMIUM: "price_premium_monthly",
      // Coaching Sessions (#24): 90 €, 72 € on Premium (FAKE_STRIPE_COACHING_SESSION_PRICES).
      STRIPE_PRICE_COACHING_SESSION: "price_coaching_session",
      STRIPE_PRICE_COACHING_SESSION_PREMIUM: "price_coaching_session_premium",
      STRIPE_API_URL: process.env.E2E_STRIPE_URL,
      ADMIN_EMAILS: "back-office@e2e.jobbbox.test,coach-office@e2e.jobbbox.test,account-office@e2e.jobbbox.test,cost-office@e2e.jobbbox.test,playbook-office@e2e.jobbbox.test,playbook-validator-office@e2e.jobbbox.test,journal-office@e2e.jobbbox.test,audit-departing-office@e2e.jobbbox.test,roles-office@e2e.jobbbox.test,keys-office@e2e.jobbbox.test,assistant-office@e2e.jobbbox.test,ai-office@e2e.jobbbox.test,guardrails-office@e2e.jobbbox.test,guardrails-validator-office@e2e.jobbbox.test,eval-runs-office@e2e.jobbbox.test,tools-office@e2e.jobbbox.test,ai-warnings-office@e2e.jobbbox.test,fantastic-office@e2e.jobbbox.test,settings-office@e2e.jobbbox.test,digest-threshold-office@e2e.jobbbox.test,contacts-settings-office@e2e.jobbbox.test,provenance-office@e2e.jobbbox.test,ai-activity-office@e2e.jobbbox.test",
      // Provider Secrets (#208): an obviously fake master key, for the Clés section.
      SECRETS_MASTER_KEYS: "1:ZTJlLW9ubHktbWFzdGVyLWtleS1lMmUtb25seS0wMDA=",
      // Enriched Contacts (#23) on Apollo, faked; the DPA flag stands for the signed agreement.
      CONTACT_ENRICHMENT_PROVIDER: "apollo",
      APOLLO_API_KEY: "e2e-apollo-key",
      // No Lusha key, whatever the shell has: the Clés specs (#208) enter one.
      LUSHA_API_KEY: "",
      // No Fantastic.jobs key either: its spec (#243) enters one in the Clés section.
      FANTASTIC_JOBS_API_KEY: "",
      CONTACT_ENRICHMENT_DPA_SIGNED: "true",
    },
  },
});
