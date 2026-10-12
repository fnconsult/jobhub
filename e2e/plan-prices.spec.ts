import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { startFakeStripe, type FakeStripe } from "../apps/web/src/billing/fake-stripe";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { derivedPort } from "./support/ports";

// Issue #103: the Plans comparison on /abonnement carries a price row, read from
// Stripe. When Stripe is not configured, cannot be reached or never answers, the
// page still renders, quickly, without that row. (The row with prices, in both
// Interface Languages, is covered in billing.spec.ts against the fake Stripe.)
// Checked on second builds of the app on the suite's database; the Candidate's
// session carries over (same AUTH_SECRET).
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));

async function startServer(offset: number, stripe: Record<string, string | undefined>, command = "start") {
  const port = derivedPort(offset);
  const origin = `http://localhost:${port}`;
  const env: NodeJS.ProcessEnv = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
  for (const key of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_STANDARD", "STRIPE_PRICE_PREMIUM", "STRIPE_API_URL"]) delete env[key];
  Object.assign(env, {
    DATABASE_URL: process.env.E2E_DATABASE_URL,
    APP_URL: origin,
    AUTH_SECRET: process.env.AUTH_SECRET ?? "e2e-only-secret-e2e-only-secret-e2e-only",
    MAIL_TRANSPORT: "console",
    ...stripe,
  });
  let output = "";
  const child: ChildProcess = spawn("npx", ["next", command, "apps/web", "-p", String(port)], { env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout!.on("data", (chunk) => (output += chunk));
  child.stderr!.on("data", (chunk) => (output += chunk));
  const stop = () => {
    try {
      process.kill(-child.pid!, "SIGTERM");
    } catch {
      // already gone
    }
  };
  try {
    await expect
      .poll(
        async () => {
          if (child.exitCode !== null) throw new Error(`web app exited (${child.exitCode}):\n${output}`);
          return fetch(`${origin}/api/health`).then((r) => r.status, () => 0);
        },
        { timeout: 90_000, message: "web app answers /api/health" },
      )
      .toBe(200);
  } catch (error) {
    stop();
    throw error;
  }
  return { origin, stop, output: () => output };
}

const configured = { STRIPE_SECRET_KEY: "sk_test_fake", STRIPE_WEBHOOK_SECRET: "whsec_test_fake", STRIPE_PRICE_STANDARD: "price_standard_monthly", STRIPE_PRICE_PREMIUM: "price_premium_monthly" };
type Variant = { name: string; offset: number; stripe: () => Promise<Record<string, string>>; command: string };
let hangingStripe: FakeStripe | undefined;
const variants: Variant[] = [
  { name: "Stripe cannot be reached", offset: 831, stripe: async () => ({ ...configured, STRIPE_API_URL: "http://127.0.0.1:9" }), command: "start" },
  {
    // An outage where Stripe takes the request and never answers: the page must not wait on it.
    name: "Stripe never answers",
    offset: 832,
    stripe: async () => {
      hangingStripe = await startFakeStripe();
      hangingStripe.stopAnswering();
      return { ...configured, STRIPE_API_URL: hangingStripe.url };
    },
    command: "start",
  },
  // A production build requires Stripe; only the development server runs without it.
  { name: "Stripe is not configured (development server)", offset: 830, stripe: async () => ({}), command: "dev" },
];

for (const variant of variants) {
  test.describe(`Plan prices when ${variant.name}`, () => {
    test.describe.configure({ mode: "serial", timeout: 180_000 });
    let server: Awaited<ReturnType<typeof startServer>>;
    test.beforeAll(async () => {
      server = await startServer(variant.offset, await variant.stripe(), variant.command);
    });
    test.afterAll(async () => {
      server?.stop();
      await hangingStripe?.stop();
      hangingStripe = undefined;
    });

    test("/abonnement still renders its comparison, without the price row", async ({ page }) => {
      await signInWithMagicLink(page, newAddress("plan-prices-down"));
      const started = Date.now();
      const response = await page.goto(`${server.origin}/abonnement`);
      expect(Date.now() - started, "/abonnement waits on Stripe for the Plan prices only a few seconds").toBeLessThan(10_000);
      expect(response?.status(), server.output()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.billing.page.title);
      await expect(page.getByRole("table").getByRole("columnheader")).toHaveText([fr.billing.page.quota, "Gratuite", "Standard", "Premium"]);
      await expect(page.getByRole("row", { name: /Match Scores/ })).toBeVisible();
      await expect(page.getByRole("row", { name: new RegExp(`^${fr.billing.page.price}`) })).toHaveCount(0);
      await expect(page.getByText("€")).toHaveCount(0);
    });
  });
}
