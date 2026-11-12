import path from "node:path";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { expect, test, type Browser } from "@playwright/test";
import { startOwnServer, signInByEmail, type OwnServer } from "./support/own-server";
import { setUpTwoStepVerificationIfAsked } from "./support/candidate";
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
let own: OwnServer, database: Pool;
async function signedIn(browser: Browser, email: string) {
  const page = await (await browser.newContext({ baseURL: own.origin, locale: "fr-FR" })).newPage();
  await signInByEmail(page, own, email);
  return page;
}
test.beforeAll(async () => {
  own = await startOwnServer(880, "coach_contracts", {
    JOBHUB_TARGET: "e2e",
    JOBHUB_IGNORE_ROOT_ENV: "1",
    AUTH_SECRET: "e2e-contract-only-secret-e2e-contract-only-secret",
    MAIL_TRANSPORT: "console",
    SECRETS_MASTER_KEYS: "1:ZTJlLW9ubHktbWFzdGVyLWtleS1lMmUtb25seS0wMDA=",
    MISTRAL_API_KEY: "e2e-mistral-key",
    AI_SCORING_PROVIDER: "mistral",
    AI_WRITING_PROVIDER: "mistral",
    AI_COACHING_PROVIDER: "mistral",
    STRIPE_SECRET_KEY: "sk_test_fake",
    STRIPE_WEBHOOK_SECRET: "whsec_test_fake",
    STRIPE_PRICE_STANDARD: "price_standard_monthly",
    STRIPE_PRICE_PREMIUM: "price_premium_monthly",
    STRIPE_API_URL: process.env.E2E_STRIPE_URL,
    NODE_OPTIONS: ["fake-coach-contract.mjs", "fake-google.mjs", "fake-mistral.mjs", "fake-reference-data.mjs"]
      .map((file) => `--import=${path.resolve("e2e/support", file)}`)
      .join(" "),
  });
  database = new Pool({ connectionString: own.databaseUrl });
});
test.afterAll(async () => {
  await database?.end();
  await own?.stop();
});
test("every Coach page is gated, then explicit acceptance opens the workspace with its private history", async ({ browser }) => {
  const email = "b2b-coach@e2e.jobbbox.test",
    page = await signedIn(browser, email);
  try {
    const id = (
      await database.query(
        "INSERT INTO human_coach(name,email,booking_url,contract_pending,public_ready) VALUES('Contract fixture coach',$1,'',true,false) RETURNING id",
        [email],
      )
    ).rows[0].id;
    for (const route of [
      "/espace-coach",
      ...["aujourdhui", "candidates", "seances", "disponibilites", "profil", "revenus", "aide"].map((x) => `/espace-coach/${x}`),
    ]) {
      await page.goto(route);
      await setUpTwoStepVerificationIfAsked(page);
      await expect(page).toHaveURL(/espace-coach\/contrat$/);
      await expect(page.getByRole("button", { name: fr.coachContract.accept, exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: fr.coachSpaceV2.pages.candidates, exact: true })).toHaveCount(0);
    }
    expect(await (await page.request.get("/api/coach-space")).json()).toEqual({ humanCoach: true, coachSpaceV2: true });
    expect(
      (await page.request.put("/api/coach-space/contact", { headers: { origin: own.origin }, data: { kind: "phone", phone: "+33123456789" } })).status(),
    ).toBe(404);
    expect(
      (
        await page.request.post("/api/coach-space/contract", {
          headers: { origin: own.origin },
          data: { kind: "coach", id, version: "2026-01-01", sha256: "e".repeat(64) },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await page.request.post("/api/coach-space/contract", {
          headers: { origin: own.origin },
          data: { kind: "coach", id, version: "2026-01-01", sha256: "tampered", accepted: true },
        })
      ).status(),
    ).toBe(409);
    await page.getByRole("checkbox", { name: fr.coachContract.agree.replace("{{version}}", "2026-01-01") }).check();
    await page.getByRole("button", { name: fr.coachContract.accept, exact: true }).click();
    await expect(page).toHaveURL(/espace-coach\/aujourdhui$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.coachSpaceV2.pages.aujourdhui);
    await page.getByRole("link", { name: fr.coachSpaceV2.pages.contrat, exact: true }).click();
    await expect(page.getByText(fr.coachContract.upToDate)).toBeVisible();
    await page.getByRole("link", { name: /Version du 2026-01-01/ }).click();
    await expect(page.getByRole("heading", { name: "E2E FIXTURE — NO LEGAL VALIDITY" })).toBeVisible();
    const exported = await (await page.request.get("/api/account/export")).json();
    expect(exported.coachContractAcceptances).toEqual([expect.objectContaining({ version: "2026-01-01", origin: "web" })]);
  } finally {
    await page.context().close();
  }
});
test("the agreement has no public legal endpoint and a regular Candidate cannot open its private archive", async ({ browser }) => {
  const page = await signedIn(browser, "b2b-candidate@e2e.jobbbox.test");
  try {
    for (const route of [
      "/legal/contrat-coach",
      "/legal/contrat-coach/versions",
      "/legal/contrat-coach/2026-01-01",
      "/api/legal/contrat-coach/pdf",
      "/api/legal/contrat-coach/in-effect",
      "/espace-coach/contrat",
      "/espace-coach/contrat/versions/2026-01-01",
    ]) {
      expect((await page.request.get(route)).status(), route).toBe(404);
    }
  } finally {
    await page.context().close();
  }
});
