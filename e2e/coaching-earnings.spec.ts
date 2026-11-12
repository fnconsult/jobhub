import path from "node:path";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { test, expect, type Browser, type Page } from "@playwright/test";
import { startOwnServer, signInByEmail, type OwnServer } from "./support/own-server";
import { setUpTwoStepVerificationIfAsked } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { coachingOffers } from "../apps/web/src/coaching-offers";
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
let own: OwnServer, database: Pool;
async function account(browser: Browser, email: string) {
  const page = await (await browser.newContext({ baseURL: own.origin, locale: "fr-FR" })).newPage();
  await signInByEmail(page, own, email);
  const id = (await database.query("SELECT id FROM candidate WHERE email=$1", [email])).rows[0].id;
  return { page, id };
}
async function accept(page: Page) {
  await setUpTwoStepVerificationIfAsked(page);
  await page.getByRole("checkbox", { name: fr.coachContract.agree.replace("{{version}}", "2026-01-01") }).check();
  await page.getByRole("button", { name: fr.coachContract.accept, exact: true }).click();
}
test.beforeAll(async () => {
  own = await startOwnServer(879, "coaching_earnings", {
    JOBHUB_TARGET: "e2e",
    JOBHUB_IGNORE_ROOT_ENV: "1",
    AUTH_SECRET: "earnings-e2e-secret-earnings-e2e-secret",
    MAIL_TRANSPORT: "console",
    SECRETS_MASTER_KEYS: "1:ZTJlLW9ubHktbWFzdGVyLWtleS1lMmUtb25seS0wMDA=",
    AI_SCORING_PROVIDER: "mistral",
    AI_WRITING_PROVIDER: "mistral",
    AI_COACHING_PROVIDER: "mistral",
    MISTRAL_API_KEY: "e2e-mistral-key",
    STRIPE_SECRET_KEY: "sk_test_fake",
    STRIPE_WEBHOOK_SECRET: "whsec_test_fake",
    STRIPE_API_URL: process.env.E2E_STRIPE_URL,
    STRIPE_PRICE_STANDARD: "price_standard_monthly",
    STRIPE_PRICE_PREMIUM: "price_premium_monthly",
    STRIPE_PRICE_COACHING_SESSION: "price_coaching_session",
    STRIPE_PRICE_COACHING_SESSION_PREMIUM: "price_coaching_session_premium",
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
test("Coach and Association statements stay private, printable and usable at 390 pixels", async ({ browser }) => {
  test.setTimeout(180000);
  const email = newAddress("earnings-coach"),
    owner = await account(browser, email),
    manager = await account(browser, newAddress("earnings-manager")),
    buyer = await account(browser, newAddress("private-buyer"));
  try {
    const coach = (await database.query("INSERT INTO human_coach(name,email,booking_url) VALUES('Sophie Revenus',$1,'') RETURNING id", [email])).rows[0].id;
    const association = (
      await database.query("INSERT INTO coach_association(name,legal_status,siret) VALUES('Association Revenus','Association','11111111111111') RETURNING id")
    ).rows[0].id;
    await database.query("INSERT INTO coach_association_manager VALUES($1,$2)", [association, manager.id]);
    const offers = coachingOffers(database, { price: async () => ({ amount: 10000, currency: "eur" }), eligibleSeller: async () => true });
    const solo = (await offers.saveSeller({
      kind: "human_coach",
      coachId: coach,
      name: "Sophie EI",
      status: "EI",
      siret: "12345678901234",
      commissionBps: 2000,
    }))!;
    const group = (await offers.saveSeller({
      kind: "association",
      name: "Association Revenus",
      status: "Association",
      siret: "11111111111111",
      commissionBps: 2000,
    }))!;
    await database.query("UPDATE coaching_seller SET association_id=$2 WHERE id=$1", [group.id, association]);
    await offers.saveOffer({ coachId: coach, sellerId: solo.id, durationMinutes: 90, amount: 10000 });
    const snapshot = (await offers.quote(buyer.id, coach))!.sale;
    for (const seller of [solo, group]) {
      const id = randomUUID(),
        checkout = `cs_${id}`;
      await database.query(
        `INSERT INTO coaching_connect_payment(id,candidate_id,coach_id,recipient_id,amount,currency,commission,payee_amount,request,sale_snapshot,payee_snapshot,created_at,paid_at,checkout_id) VALUES($1,$2,$3,$4,10000,'eur',2000,8000,'{}',$5,$6,'2026-06-01','2026-06-01',$7)`,
        [id, buyer.id, coach, seller.id, { ...snapshot, seller }, seller, checkout],
      );
      await database.query("INSERT INTO coaching_connect_earning(payment_id,amount,commission,available) VALUES($1,10000,2000,true)", [id]);
      await database.query(
        "INSERT INTO coaching_session(candidate_id,coach_id,stripe_checkout_session_id,amount,currency,scheduled_at,duration_minutes,note) VALUES($1,$2,$3,10000,'eur','2026-06-04',90,'PRIVATE_BUYER_NOTE')",
        [buyer.id, coach, checkout],
      );
    }
    await owner.page.goto("/espace-coach/revenus");
    await accept(owner.page);
    await manager.page.goto("/espace-association");
    await accept(manager.page);
    for (const [page, route, seller] of [
      [owner.page, "/espace-coach/revenus", solo],
      [manager.page, `/espace-association/${association}/revenus`, group],
    ] as const) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${route}?mois=2026-06`);
      await expect(page.getByRole("heading", { name: fr.coachEarnings.offers, exact: true })).toBeVisible();
      // One table, scrolling in its own frame on a phone rather than widening the page.
      await expect(page.getByRole("table", { name: fr.coachEarnings.offers, exact: true })).toContainText("Sophie Revenus");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.locator("body")).not.toContainText("PRIVATE_BUYER_NOTE");
      await page.screenshot({path:`/tmp/earnings-${seller.kind}-390.png`,fullPage:true});
      const pdf = await page.request.get(`/api/coaching/earnings/${seller.id}/pdf?mois=2026-06`);
      expect(pdf.status()).toBe(200);
      expect(pdf.headers()["cache-control"]).toBe("private, no-store");
      expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
      expect((await buyer.page.request.get(`/api/coaching/earnings/${seller.id}/pdf?mois=2026-06`)).status()).toBe(404);
      await page.getByLabel(fr.coachEarnings.month, { exact: true }).fill("2026-05");
      await page.getByRole("button", { name: fr.coachEarnings.show, exact: true }).click();
      await expect(page).toHaveURL(/mois=2026-05/);
      await expect(page.getByRole("table", { name: fr.coachEarnings.offers, exact: true })).toHaveCount(0);
    }
    expect((await owner.page.request.get(`/api/coaching/earnings/${group.id}/pdf`)).status()).toBe(404);
    expect((await owner.page.request.get(`/api/coaching/earnings/${solo.id}/pdf?mois=not-a-month`)).status()).toBe(404);
    const anon = await browser.newContext({ baseURL: own.origin });
    expect((await anon.request.get(`/api/coaching/earnings/${solo.id}/pdf`)).status()).toBe(401);
    await anon.close();
    await database.query("DELETE FROM coach_association_manager WHERE association_id=$1", [association]);
    expect((await manager.page.request.get(`/api/coaching/earnings/${group.id}/pdf`)).status()).toBe(404);
  } finally {
    await owner.page.context().close();
    await manager.page.context().close();
    await buyer.page.context().close();
  }
});
