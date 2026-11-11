import path from "node:path";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { test, expect } from "@playwright/test";
import { startOwnServer, signInByEmail, type OwnServer } from "./support/own-server";
import { emailsIn, newAddress } from "./support/mailbox";
import { setUpTwoStepVerificationIfAsked } from "./support/candidate";
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const ADMIN = "content-reports-admin@e2e.jobbbox.test";
let own: OwnServer, database: Pool;
test.beforeAll(async () => {
  own = await startOwnServer(886, "coaching_content_reports", {
    JOBHUB_TARGET: "e2e",
    JOBHUB_IGNORE_ROOT_ENV: "1",
    ADMIN_EMAILS: ADMIN,
    AUTH_SECRET: "content-reports-e2e-secret-content-reports-e2e-secret",
    MAIL_TRANSPORT: "console",
    MAIL_FROM: "Jobbbox <team@e2e.jobbbox.test>",
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
    NODE_OPTIONS: ["fake-google.mjs", "fake-mistral.mjs", "fake-reference-data.mjs"].map((file) => `--import=${path.resolve("e2e/support", file)}`).join(" "),
  });
  database = new Pool({ connectionString: own.databaseUrl });
});
test.afterAll(async () => {
  await database?.end();
  await own?.stop();
});
test("anonymous report receives a receipt; audited human decision reaches both parties at 390px", async ({ browser }) => {
  test.setTimeout(180000);
  const seller = newAddress("content-coach"),
    reporter = newAddress("content-visitor");
  const coach = (
    await database.query(
      "INSERT INTO human_coach(name,email,booking_url,bio,public_ready) VALUES('Public Coach',$1,'','Professional coaching presentation',true) RETURNING id",
      [seller],
    )
  ).rows[0].id;
  const candidate = await (await browser.newContext({ baseURL: own.origin, locale: "fr-FR" })).newPage();
  const visitor = await (await browser.newContext({ baseURL: own.origin, locale: "fr-FR", viewport: { width: 390, height: 844 } })).newPage();
  const admin = await (await browser.newContext({ baseURL: own.origin, locale: "fr-FR" })).newPage();
  try {
    await signInByEmail(candidate, own, newAddress("content-buyer"));
    await candidate.goto("/coachs");
    const href = await candidate.getByRole("link", { name: fr.contentReport.reportPage, exact: true }).getAttribute("href");
    expect(href).toContain(coach);
    await expect(candidate.getByRole("link", { name: fr.contentReport.reportOffer, exact: true })).toBeVisible();
    await visitor.goto(href!);
    await expect(visitor.getByRole("heading", { name: fr.contentReport.title, exact: true })).toBeVisible();
    await visitor.getByLabel(fr.contentReport.explanation, { exact: true }).fill("The professional qualification shown needs verification.");
    await visitor.getByLabel(fr.contentReport.name, { exact: true }).fill("Anonymous visitor");
    await visitor.getByLabel(fr.contentReport.emailAddress, { exact: true }).fill(reporter);
    await visitor.getByRole("checkbox", { name: fr.contentReport.goodFaith, exact: true }).check();
    await visitor.getByRole("button", { name: fr.contentReport.send, exact: true }).click();
    await expect(visitor.getByRole("status")).toContainText(fr.contentReport.received);
    await expect.poll(() => emailsIn(own.output(), reporter).filter((mail) => mail.subject === fr.contentReport.email.receipt).length).toBe(1);
    expect(await visitor.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const report = (await database.query("SELECT id FROM coaching_content_report WHERE reporter_email=$1", [reporter])).rows[0].id;
    await signInByEmail(admin, own, ADMIN);
    await admin.goto("/admin/signalements");
    await setUpTwoStepVerificationIfAsked(admin);
    const article = admin.getByRole("article").filter({ hasText: report });
    await article.getByLabel(fr.contentReport.admin.outcome, { exact: true }).selectOption("suspend");
    await article.getByLabel(fr.contentReport.admin.reason, { exact: true }).fill("Professional qualification evidence required.");
    await article.getByRole("button", { name: fr.contentReport.admin.decide, exact: true }).click();
    await expect.poll(() => emailsIn(own.output(), reporter).filter((mail) => mail.subject === fr.contentReport.email.decision).length).toBe(1);
    await expect.poll(() => emailsIn(own.output(), seller).filter((mail) => mail.subject === fr.contentReport.email.decision).length).toBe(1);
    expect(emailsIn(own.output(), seller).at(-1)!.text).not.toContain(reporter);
    expect((await database.query("SELECT count(*)::int AS n FROM back_office_audit WHERE target=$1", [report])).rows[0].n).toBeGreaterThan(0);
    await candidate.goto("/coachs");
    await expect(candidate.getByRole("heading", { name: "Public Coach", exact: true })).toHaveCount(0);
    await visitor.evaluate(()=>window.scrollTo(0,0));
    await visitor.screenshot({ path: "/tmp/coaching-content-report-390.png", fullPage: true });
  } finally {
    await Promise.all([candidate.context().close(), visitor.context().close(), admin.context().close()]);
  }
});
