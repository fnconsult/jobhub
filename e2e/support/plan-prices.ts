import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";
import { derivedPort } from "./ports";

// Issue #103: the Plans comparison on /abonnement, checked on second servers of the app
// (e2e/plan-prices.spec.ts, e2e/plan-prices-dev.spec.ts) on the suite's database; the
// Candidate's session carries over (same AUTH_SECRET).
export const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));

export type PlanPricesServer = { origin: string; stop: () => void; output: () => string };

/** The web app on E2E_WEB_PORT + `offset`, through `next start` (the build) or `next dev`, with only `stripe`'s Stripe variables. */
export async function startServer(offset: number, stripe: Record<string, string | undefined>, command: "start" | "dev"): Promise<PlanPricesServer> {
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

/** /abonnement on `server`, opened by a signed-in Candidate, renders quickly and has its comparison but no price row. */
export async function expectComparisonWithoutPrices(page: Page, server: PlanPricesServer): Promise<void> {
  const started = Date.now();
  const response = await page.goto(`${server.origin}/abonnement`);
  expect(Date.now() - started, "/abonnement waits on Stripe for the Plan prices only a few seconds").toBeLessThan(10_000);
  expect(response?.status(), server.output()).toBe(200);
  await expect(page.getByRole("heading", { level: 2, name: fr.billing.page.title })).toBeVisible();
  // The Plan comparison cards (#469). A Plan offered by plans.spec.ts while this runs is ranked after these three.
  const plans = page.getByRole("region", { name: fr.billing.page.comparisonTitle });
  await expect(plans.getByRole("article").first()).toBeVisible();
  expect((await plans.getByRole("article").getByRole("heading").allInnerTexts()).slice(0, 3)).toEqual(["Gratuite", "Standard", "Premium"]);
  await expect(plans.getByRole("article").first()).toContainText("Match Scores");
  await expect(page.locator(".plan-card-price")).toHaveCount(0);
  await expect(page.getByText("€")).toHaveCount(0);
}

export const configuredStripe = {
  STRIPE_SECRET_KEY: "sk_test_fake",
  STRIPE_WEBHOOK_SECRET: "whsec_test_fake",
  STRIPE_PRICE_STANDARD: "price_standard_monthly",
  STRIPE_PRICE_PREMIUM: "price_premium_monthly",
};
