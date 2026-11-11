import path from "node:path";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { test, expect, type Browser, type Page } from "@playwright/test";
import { startOwnServer, signInByEmail, type OwnServer } from "./support/own-server";
import { newAddress } from "./support/mailbox";
import { setUpTwoStepVerificationIfAsked } from "./support/candidate";
import { platformSettingsStore } from "../apps/web/src/platform-settings";
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
let own: OwnServer, database: Pool;
async function account(browser: Browser, email: string) {
  const page = await (await browser.newContext({ baseURL: own.origin, locale: "fr-FR" })).newPage();
  await signInByEmail(page, own, email);
  return page;
}
test.beforeAll(async () => {
  own = await startOwnServer(885, "coaching_notifications", {
    JOBHUB_TARGET: "e2e",
    JOBHUB_IGNORE_ROOT_ENV: "1",
    AUTH_SECRET: "notifications-e2e-auth-secret-notifications-e2e-secret",
    MAIL_TRANSPORT: "console",
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
    NODE_OPTIONS: [
      "fake-coach-contract.mjs",
      "fake-coaching-legal.mjs",
      "fake-coaching-notification-legal.mjs",
      "fake-google.mjs",
      "fake-mistral.mjs",
      "fake-reference-data.mjs",
    ]
      .map((file) => `--import=${path.resolve("e2e/support", file)}`)
      .join(" "),
  });
  database = new Pool({ connectionString: own.databaseUrl });
  await platformSettingsStore(database, {}).set("COACH_SPACE_V2_ENABLED", "true", "e2e-settings");
  await platformSettingsStore(database, {}).set("CAL_COM_REMINDERS_DISABLED", "true", "e2e-settings");
});
test.afterAll(async () => {
  await database?.end();
  await own?.stop();
});
async function toggle(page: Page, label: string) {
  const saved = page.waitForResponse((response) => response.url().endsWith("/api/account/coaching-notifications") && response.request().method() === "PUT");
  await page.getByRole("checkbox", { name: label, exact: true }).uncheck();
  expect((await saved).ok()).toBe(true);
  await page.reload();
  await expect(page.getByRole("checkbox", { name: label, exact: true })).not.toBeChecked();
}
test("Candidate and Coach own their reminder settings; private reminder links expose joining at 390px", async ({ browser }) => {
  test.setTimeout(180000);
  const coachEmail = newAddress("reminder-coach"),
    buyerEmail = newAddress("reminder-buyer");
  const coach = (
    await database.query(
      "INSERT INTO human_coach(name,email,booking_url,bio,public_ready) VALUES('Rappel Coach',$1,'https://cal.com/team/jobbbox/reminder','Approved professional coach',true) RETURNING id",
      [coachEmail],
    )
  ).rows[0].id;
  const owner = await account(browser, coachEmail),
    buyer = await account(browser, buyerEmail);
  try {
    await owner.goto("/espace-coach/rappels");
    await setUpTwoStepVerificationIfAsked(owner);
    await owner.getByRole("checkbox", { name: fr.coachContract.agree.replace("{{version}}", "2026-01-01") }).check();
    await owner.getByRole("button", { name: fr.coachContract.accept, exact: true }).click();
    await owner.getByRole("link", { name: fr.coachSpaceV2.pages.rappels, exact: true }).click();
    await toggle(owner, fr.coachingNotices.settings.daily);
    await buyer.goto("/compte/rappels");
    await toggle(buyer, fr.coachingNotices.settings.hourEmail);
    await expect(buyer.getByRole("switch", { name: fr.pushNotifications.events.coaching_session_hour, exact: true })).toBeChecked();
    expect((await buyer.request.get("/espace-coach/rappels")).status()).toBe(404);
    expect(
      (
        await buyer.request.put("/api/account/coaching-notifications", {
          headers: { origin: own.origin },
          data: { hourEmail: true, candidateId: "another-person" },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await buyer.request.put("/api/account/coaching-notifications", { headers: { origin: "https://untrusted.example" }, data: { hourEmail: true } })
      ).status(),
    ).toBe(403);
    const candidate = (await database.query("SELECT id FROM candidate WHERE email=$1", [buyerEmail])).rows[0].id;
    const target = "https://meet.google.com/aaa-bbbb-ccc";
    const session = (
      await database.query(
        "INSERT INTO coaching_session(candidate_id,coach_id,stripe_checkout_session_id,amount,currency,scheduled_at,duration_minutes,video_link) VALUES($1,$2,'cs_reminder_browser',9000,'eur',$3,60,$4) RETURNING id",
        [candidate, coach, new Date(Date.now() + 5 * 60000), target],
      )
    ).rows[0].id;
    for (const [page, url] of [
      [buyer, `/coachs/seances/${session}`],
      [owner, `/espace-coach/seances/${session}`],
    ] as const) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(url);
      await expect(page.getByRole("link", { name: "Rejoindre sur Google Meet", exact: true }).first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await owner.goto("/espace-coach/rappels");
    await expect(owner.getByRole("checkbox", { name: fr.coachingNotices.settings.daily, exact: true })).not.toBeChecked();
    await owner.screenshot({ path: "/tmp/coaching-reminders-390.png", fullPage: true });
  } finally {
    await Promise.all([owner.context().close(), buyer.context().close()]);
  }
});
