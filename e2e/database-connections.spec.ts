import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { derivedPort } from "./support/ports";

// The web app shares one bounded Postgres connection pool per process, whatever
// the number of modules reading the database. Postgres refuses clients past
// max_connections (100 by default) with "sorry, too many clients already", and
// every server instance, the worker and the suite share that budget: a module
// with a Pool of its own (10 connections each) let one busy server hold well over
// a hundred, so pages failed with "Une erreur est survenue" under load.
// Driven on a second build of the app whose connections carry their own
// application_name, so they can be counted apart from everyone else's.
const origin = process.env.E2E_WEB_ORIGIN!;
const POOL_MAX = 10;

test.describe("Database connections", () => {
  test.describe.configure({ timeout: 180_000 });

  test("a busy web app holds at most one pool's worth of Postgres connections", async ({ page }) => {
    const applicationName = `jobhub-e2e-pool-${Date.now().toString(36)}`;
    const databaseUrl = new URL(process.env.E2E_DATABASE_URL!);
    databaseUrl.searchParams.set("application_name", applicationName);

    // A Candidate with an Application: its page reads from most of the app's modules.
    await signInWithMagicLink(page, newAddress("db-connections"));
    const profile = await page.request.post("/api/profiles", {
      data: { masterCv: { fullName: "Marie Dupont", headline: "DAF", email: "", phone: "", location: "Lyon", summary: "", experience: [], education: [], skills: [], languages: [] }, searchCriteria: { targetRole: "DAF", location: "Lyon" } },
      headers: { origin },
    });
    expect(profile.status(), await profile.text()).toBe(201);
    const offer = await page.request.post("/api/job-offers", {
      data: { title: "DAF H/F", content: `(réf. ${applicationName}) Poste de DAF.`, employer: "Acme Industrie", location: "Lyon" },
      headers: { origin },
    });
    expect(offer.status(), await offer.text()).toBe(200);
    const saved = await page.request.post("/api/applications", { data: { jobOfferId: (await offer.json()).id, profileId: (await profile.json()).id }, headers: { origin } });
    expect(saved.ok(), await saved.text()).toBe(true);
    const applicationId = (await saved.json()).id as string;

    const port = derivedPort(780);
    const serverOrigin = `http://localhost:${port}`;
    let output = "";
    const child: ChildProcess = spawn("npx", ["next", "start", "apps/web", "-p", String(port)], {
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: "1",
        DATABASE_URL: databaseUrl.toString(),
        APP_URL: serverOrigin,
        AUTH_SECRET: process.env.AUTH_SECRET ?? "e2e-only-secret-e2e-only-secret-e2e-only",
        MAIL_TRANSPORT: "console",
        MISTRAL_API_KEY: "e2e-mistral-key",
        PERPLEXITY_API_KEY: "e2e-perplexity-key",
        STRIPE_SECRET_KEY: "sk_test_fake",
        STRIPE_WEBHOOK_SECRET: "whsec_test_fake",
        STRIPE_PRICE_STANDARD: "price_standard_monthly",
        STRIPE_PRICE_PREMIUM: "price_premium_monthly",
        STRIPE_API_URL: process.env.E2E_STRIPE_URL,
        NODE_OPTIONS: ["fake-mistral.mjs", "fake-company-sources.mjs"].map((f) => `--import=${path.resolve("e2e/support", f)}`).join(" "),
      },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (chunk) => (output += chunk));
    child.stderr!.on("data", (chunk) => (output += chunk));
    const counter = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
    try {
      await counter.connect();
      await expect
        .poll(
          async () => {
            if (child.exitCode !== null) throw new Error(`web app exited (${child.exitCode}):\n${output}`);
            // Our server, not another one already on the port.
            if (!/Ready in/.test(output)) return 0;
            return fetch(`${serverOrigin}/api/health`).then((r) => r.status, () => 0);
          },
          { timeout: 90_000, message: "this web app answers /api/health" },
        )
        .toBe(200);

      const connections = async () =>
        Number((await counter.query("SELECT count(*) AS n FROM pg_stat_activity WHERE application_name = $1", [applicationName])).rows[0].n);
      let peak = 0;
      let loading = true;
      const sampling = (async () => {
        while (loading) {
          peak = Math.max(peak, await connections());
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      })();

      const urls = [`/candidatures/${applicationId}`, "/candidatures", "/profils", "/compte", `/api/applications/${applicationId}/enriched-contacts`];
      for (let round = 0; round < 3; round++) {
        const responses = await Promise.all(
          Array.from({ length: 40 }, (_, i) => page.request.get(`${serverOrigin}${urls[i % urls.length]}`, { maxRedirects: 0 })),
        );
        for (const response of responses) expect(response.status(), `${response.url()}\n${output.slice(-2000)}`).toBeLessThan(500);
      }
      loading = false;
      await sampling;
      peak = Math.max(peak, await connections());

      expect(peak, `Postgres connections held by one web app (application_name=${applicationName})`).toBeGreaterThan(0);
      expect(peak, `Postgres connections held by one web app (application_name=${applicationName})`).toBeLessThanOrEqual(POOL_MAX);
    } finally {
      await counter.end().catch(() => {});
      try {
        process.kill(-child.pid!, "SIGTERM");
      } catch {
        // already gone
      }
    }
  });
});
