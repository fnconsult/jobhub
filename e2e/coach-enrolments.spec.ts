import path from "node:path";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { expect, test, type Page, type Browser } from "@playwright/test";
import { startOwnServer, signInByEmail, type OwnServer } from "./support/own-server";
import { emailsIn, linkIn, newAddress } from "./support/mailbox";
import { setUpTwoStepVerificationIfAsked } from "./support/candidate";
import { platformSettingsStore } from "../apps/web/src/platform-settings";
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const copy = fr.coachEnrolment,
  ADMIN = "coach-enrolment-office@e2e.jobbbox.test";
let own: OwnServer, database: Pool, admin: Page, pdf: Buffer;
async function personPage(browser: Browser, email: string) {
  const context = await browser.newContext({ baseURL: own.origin, locale: "fr-FR" });
  const page = await context.newPage();
  await signInByEmail(page, own, email);
  return page;
}
async function fill(page: Page, email: string, legalName: string, kind = "coach") {
  await page.goto("/devenir-coach");
  await page.getByLabel(copy.kind, { exact: true }).selectOption(kind);
  const fields = {
    contactName: "Sophie Martin",
    legalName,
    email,
    status: kind === "association" ? "Association loi 1901" : "EI",
    siret: kind === "association" ? "12345678901235" : "12345678901234",
    specialties: "Reconversion, cadres",
    languages: "français, anglais",
    presentation: "Accompagnement professionnel des cadres dans leurs transitions de carrière.",
  };
  for (const [key, value] of Object.entries(fields)) await page.getByLabel(copy.fields[key], { exact: true }).fill(value);
  await page.locator('input[type="file"]').setInputFiles({ name: "qualification.pdf", mimeType: "application/pdf", buffer: pdf });
  const sent = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/coach-enrolments" && response.request().method() === "POST");
  await page.getByRole("button", { name: copy.submit, exact: true }).click();
  const answer = await sent;
  expect(answer.status(), await answer.text()).toBe(201);
}
const card = (legalName: string) => admin.locator("article").filter({ has: admin.getByRole("heading", { name: legalName, exact: true }) });
test.beforeAll(async ({ browser }) => {
  own = await startOwnServer(875, "coach_enrolments", {
    JOBHUB_TARGET: "e2e",
    JOBHUB_IGNORE_ROOT_ENV: "1",
    SECRETS_MASTER_KEYS: "1:ZTJlLW9ubHktbWFzdGVyLWtleS1lMmUtb25seS0wMDA=",
    STRIPE_SECRET_KEY: "sk_test_fake",
    STRIPE_WEBHOOK_SECRET: "whsec_test_fake",
    STRIPE_PRICE_STANDARD: "price_standard_monthly",
    STRIPE_PRICE_PREMIUM: "price_premium_monthly",
    STRIPE_PRICE_COACHING_SESSION: "price_coaching_session",
    STRIPE_PRICE_COACHING_SESSION_PREMIUM: "price_coaching_session_premium",
    STRIPE_API_URL: process.env.E2E_STRIPE_URL,
    ADMIN_EMAILS: ADMIN,
    AUTH_SECRET: "e2e-enrolment-secret-e2e-enrolment-secret",
    MAIL_TRANSPORT: "console",
    GOOGLE_CLIENT_ID: "e2e-client.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "e2e-client-secret",
    MISTRAL_API_KEY: "e2e-mistral-key",
    AI_SCORING_PROVIDER: "mistral",
    AI_WRITING_PROVIDER: "mistral",
    AI_COACHING_PROVIDER: "mistral",
    NODE_OPTIONS: ["fake-google.mjs", "fake-mistral.mjs", "fake-reference-data.mjs"].map((file) => `--import=${path.resolve("e2e/support", file)}`).join(" "),
  });
  database = new Pool({ connectionString: own.databaseUrl });
  admin = await personPage(browser, ADMIN);
  await platformSettingsStore(database, {}).set("COACH_SPACE_V2_ENABLED", "true", ADMIN);
  const profile = await admin.request.post("/api/profiles", {
    headers: { origin: own.origin },
    data: {
      masterCv: {
        fullName: "Qualification Fixture",
        headline: "Coach carrière",
        email: "qualification@example.test",
        phone: "",
        location: "Lyon",
        summary: "Qualifications professionnelles.",
        experience: [],
        education: [],
        skills: ["Accompagnement"],
        languages: [],
      },
      searchCriteria: { targetRole: "Coach", locations: ["Lyon"] },
    },
  });
  expect(profile.status(), await profile.text()).toBe(201);
  const id = (await profile.json()).id;
  const exported = await admin.request.get(`/api/profiles/${id}/master-cv/export?format=pdf&template=classic`);
  expect(exported.ok()).toBe(true);
  pdf = await exported.body();
});
test.afterAll(async () => {
  await admin?.context().close();
  await database?.end();
  await own?.stop();
});
test("a guest confirms their address, is approved with audit, and stays behind the contract and publication gates", async ({ browser }) => {
  test.setTimeout(120000);
  const context = await browser.newContext({ baseURL: own.origin, locale: "fr-FR" });
  const page = await context.newPage();
  const email = newAddress("enrol-guest"),
    name = `Cabinet Sophie ${Date.now()}`;
  try {
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/devenir-coach");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.title);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.goto("/en/devenir-coach");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Become a coach on Jobbbox");
    await fill(page, email, name);
    await expect(page.getByRole("status")).toHaveText(copy.sent);
    await expect.poll(() => emailsIn(own.output(), email).length).toBeGreaterThan(0);
    await admin.goto("/admin/coachs");
    await expect(admin.getByRole("heading", { name, exact: true })).toHaveCount(0);
    await page.goto(linkIn(emailsIn(own.output(), email)[0]!));
    await setUpTwoStepVerificationIfAsked(page);
    await expect(page.getByRole("button", { name: copy.confirm, exact: true })).toBeVisible();
    const id = (await database.query("SELECT id FROM coach_enrolment WHERE email=$1", [email])).rows[0].id;
    expect((await database.query("SELECT state FROM coach_enrolment WHERE id=$1", [id])).rows[0].state).toBe("awaiting_email");
    await page.getByRole("button", { name: copy.confirm, exact: true }).click();
    await expect(page).toHaveURL(/devenir-coach\/mes-demandes$/);
    await expect(page.getByText(copy.state.pending, { exact: true })).toBeVisible();
    const data = await (await page.request.get("/api/account/export")).json();
    expect(Buffer.from(data.coachEnrolments[0].proof.base64, "base64").equals(pdf)).toBe(true);
    expect((await page.request.get(`/api/admin/coach-enrolments/${id}/proof`)).status()).toBe(404);
    await admin.goto(`/admin/coachs/demandes/${id}`);
    await expect(admin.locator(".ds-viewer canvas").first()).toBeVisible();
    await admin.goto("/admin/coachs");
    await card(name).getByRole("button", { name: copy.approve, exact: true }).click();
    await expect(card(name).getByText(copy.state.approved, { exact: true })).toBeVisible();
    const application = (await database.query("SELECT human_coach_id FROM coach_enrolment WHERE id=$1", [id])).rows[0];
    const coachId = application.human_coach_id;
    expect((await database.query("SELECT contract_pending,public_ready FROM human_coach WHERE id=$1", [coachId])).rows[0]).toEqual({
      contract_pending: true,
      public_ready: false,
    });
    expect((await database.query("SELECT after FROM back_office_audit WHERE target=$1 AND action='updated'", [id])).rows[0].after).toMatchObject({
      state: "approved",
      humanCoachId: coachId,
    });
    await expect.poll(() => emailsIn(own.output(), email).some((message) => message.subject === copy.email.approved)).toBe(true);
    await page.goto("/espace-coach/aujourdhui");
    await setUpTwoStepVerificationIfAsked(page);
    await expect(page).toHaveURL(/espace-coach\/contrat$/);
    await expect(page.getByText(copy.awaitingContract)).toBeVisible();
    await expect(page.getByRole("link", { name: fr.coachSpaceV2.pages.candidates, exact: true })).toHaveCount(0);
    const coaches = (await (await page.request.get("/api/coaching")).json()).coaches;
    expect(coaches.some((coach: { id: string }) => coach.id === coachId)).toBe(false);
    const accountId = (await database.query("SELECT id FROM candidate WHERE email=$1", [email])).rows[0].id;
    expect(
      (
        await page.request.put(`/api/coach-space/candidates/${accountId}/notes`, {
          headers: { origin: own.origin },
          data: { text: "not allowed", revision: 0 },
        })
      ).status(),
    ).toBe(404);
  } finally {
    await context.close();
  }
});
test("a declined applicant receives the exact reason and can export and remove their proof", async ({ browser }) => {
  const email = newAddress("enrol-declined"),
    name = `Cabinet refusé ${Date.now()}`;
  const page = await personPage(browser, email);
  const reason = "Merci de préciser vos qualifications en accompagnement professionnel.";
  try {
    await fill(page, email, name);
    await expect(page).toHaveURL(/mes-demandes$/);
    await admin.goto("/admin/coachs");
    await card(name).getByLabel(copy.reason, { exact: true }).fill(reason);
    await card(name).getByRole("button", { name: copy.refuse, exact: true }).click();
    await expect(card(name).getByText(copy.state.refused, { exact: true })).toBeVisible();
    await expect
      .poll(() => emailsIn(own.output(), email).some((message) => message.subject === copy.email.refused && message.text.includes(reason)))
      .toBe(true);
    const data = await (await page.request.get("/api/account/export")).json();
    expect(data.coachEnrolments[0]).toMatchObject({ state: "refused", reason });
    expect(data.coachEnrolments[0]).not.toHaveProperty("noticeClaim");
    const id = data.coachEnrolments[0].id;
    expect((await page.request.delete("/api/account", { headers: { origin: own.origin }, data: { email } })).status()).toBe(204);
    expect((await database.query("SELECT id FROM coach_enrolment WHERE id=$1", [id])).rows).toHaveLength(0);
  } finally {
    await page.context().close();
  }
});
test("an approved Association receives only its manager identity and never a Human Coach or Candidate workspace", async ({ browser }) => {
  const email = newAddress("enrol-association"),
    name = `Association Transitions ${Date.now()}`;
  const page = await personPage(browser, email);
  try {
    await fill(page, email, name, "association");
    await expect(page).toHaveURL(/mes-demandes$/);
    await admin.goto("/admin/coachs");
    await card(name).getByRole("button", { name: copy.approve, exact: true }).click();
    await expect(card(name).getByText(copy.state.approved, { exact: true })).toBeVisible();
    const data = await (await page.request.get("/api/account/export")).json();
    expect(data.managedAssociations).toEqual([expect.objectContaining({ name, siret: "12345678901235" })]);
    expect((await database.query("SELECT id FROM human_coach WHERE email=$1", [email])).rows).toHaveLength(0);
    await page.goto("/espace-coach/candidates");
    await expect(page).toHaveURL(/espace-coach\/contrat$/);
    await expect(page.getByText(copy.awaitingContract)).toBeVisible();
    await expect(page.getByRole("link", { name: fr.coachSpaceV2.pages.candidates, exact: true })).toHaveCount(0);
    expect((await page.request.delete("/api/account", { headers: { origin: own.origin }, data: { email } })).status()).toBe(204);
    expect((await database.query("SELECT * FROM coach_association_manager WHERE association_id=$1", [data.managedAssociations[0].id])).rows).toHaveLength(0);
    expect((await database.query("SELECT retired_at FROM coach_association WHERE id=$1", [data.managedAssociations[0].id])).rows[0].retired_at).not.toBeNull();
  } finally {
    await page.context().close();
  }
});
