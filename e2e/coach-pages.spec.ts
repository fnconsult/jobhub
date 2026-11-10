import path from "node:path";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { Pool } from "pg";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { startOwnServer, signInByEmail, type OwnServer } from "./support/own-server";
import { setUpTwoStepVerificationIfAsked } from "./support/candidate";
import { emailsIn, newAddress } from "./support/mailbox";
import { platformSettingsStore } from "../apps/web/src/platform-settings";
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8")),
  copy = fr.coachPage,
  ADMIN = "coach-page-office@e2e.jobbbox.test",
  NAME = "Sophie Public Profile";
let own: OwnServer, database: Pool;
async function account(browser: Browser, email: string) {
  const page = await (await browser.newContext({ baseURL: own.origin, locale: "fr-FR" })).newPage();
  await signInByEmail(page, own, email);
  return page;
}
const photoAlt = copy.photoAlt.replace("{{name}}", NAME);
function queueCard(admin: Page) {
  return admin.locator("article").filter({ has: admin.getByRole("heading", { name: NAME, exact: true }) });
}
async function save(page: Page, presentation: string) {
  await page.getByLabel(copy.presentation, { exact: true }).fill(presentation);
  const saved=page.waitForResponse(response=>new URL(response.url()).pathname==="/api/coach-space/profile"&&response.request().method()==="POST");
  await page.getByRole("button", { name: copy.submit, exact: true }).click();
  const response=await saved;expect(response.status(),await response.text()).toBe(201);
  await expect(page.getByRole("status").filter({ hasText: copy.status.pending })).toBeVisible();
}
test.beforeAll(async () => {
  own = await startOwnServer(877, "coach_pages", {
    JOBHUB_TARGET: "e2e",
    JOBHUB_IGNORE_ROOT_ENV: "1",
    ADMIN_EMAILS: ADMIN,
    AUTH_SECRET: "e2e-coach-page-secret-e2e-coach-page-secret",
    MAIL_TRANSPORT: "console",
    SECRETS_MASTER_KEYS: "1:ZTJlLW9ubHktbWFzdGVyLWtleS1lMmUtb25seS0wMDA=",
    AI_SCORING_PROVIDER: "mistral",
    AI_WRITING_PROVIDER: "mistral",
    AI_COACHING_PROVIDER: "mistral",
    MISTRAL_API_KEY: "e2e-mistral-key",
    STRIPE_SECRET_KEY: "sk_test_fake",
    STRIPE_WEBHOOK_SECRET: "whsec_test_fake",
    STRIPE_PRICE_STANDARD: "price_standard_monthly",
    STRIPE_PRICE_PREMIUM: "price_premium_monthly",
    STRIPE_PRICE_COACHING_SESSION: "price_coaching_session",
    STRIPE_PRICE_COACHING_SESSION_PREMIUM: "price_coaching_session_premium",
    STRIPE_API_URL: process.env.E2E_STRIPE_URL,
    NODE_OPTIONS: ["fake-coach-contract.mjs", "fake-google.mjs", "fake-mistral.mjs", "fake-reference-data.mjs"]
      .map((file) => `--import=${path.resolve("e2e/support", file)}`)
      .join(" "),
  });
  database = new Pool({ connectionString: own.databaseUrl });
  await platformSettingsStore(database, {}).set("COACH_SPACE_V2_ENABLED", "true", ADMIN);
});
test.afterAll(async () => {
  await database?.end();
  await own?.stop();
});
test("a Coach edits privately, an Administrator approves/refuses with audit/email, and Candidates see only approved text and portraits", async ({
  browser,
}) => {
  test.setTimeout(180000);
  const email = newAddress("coach-public-page"),
    admin = await account(browser, ADMIN);
  let owner: Page | undefined, candidate: Page | undefined;
  const anonymous = await browser.newContext({ baseURL: own.origin });
  try {
    await admin.goto("/admin/coachs");
    await admin.getByLabel(fr.admin.humanCoaches.name, { exact: true }).fill(NAME);
    await admin.getByLabel(fr.admin.humanCoaches.email, { exact: true }).fill(email);
    await admin.getByLabel(fr.admin.humanCoaches.bookingUrl, { exact: true }).fill("https://cal.com/coach-profile/session");
    await expect(admin.getByLabel(fr.admin.humanCoaches.bio)).toHaveCount(0);
    await admin.getByRole("button", { name: fr.admin.humanCoaches.add, exact: true }).click();
    await expect(admin.getByRole("status")).toHaveText(fr.admin.humanCoaches.added.replace("{{name}}",NAME));
    const id = (await database.query("SELECT id FROM human_coach WHERE email=$1", [email])).rows[0].id;
    owner = await account(browser, email);
    await owner.goto("/espace-coach/profil");
    await setUpTwoStepVerificationIfAsked(owner);
    await expect(owner).toHaveURL(/espace-coach\/contrat$/);
    await owner.getByRole("checkbox", { name: fr.coachContract.agree.replace("{{version}}", "2026-01-01") }).check();
    await owner.getByRole("button", { name: fr.coachContract.accept, exact: true }).click();
    await expect(owner).toHaveURL(/espace-coach\/aujourdhui$/);
    await owner.goto("/espace-coach/profil");
    await expect(owner.getByRole("heading",{name:copy.edit,exact:true})).toBeVisible();
    candidate = await account(browser, newAddress("public-profile-reader"));
    await candidate.goto("/coachs");
    await expect(candidate.getByRole("heading", { name: NAME, exact: true })).toHaveCount(0);
    const first = "Accompagnement des cadres en reconversion, validé avec une première photo.";
    await owner.getByLabel(copy.specialties, { exact: true }).fill("Reconversion, Cadres");
    await owner.getByLabel(copy.languages, { exact: true }).fill("français, anglais");
    const jpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 180, g: 110, b: 90 } } })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    await owner.locator('input[type="file"]').setInputFiles({ name: "portrait.jpg", mimeType: "image/jpeg", buffer: jpeg });
    await save(owner, first);
    const version1 = (await database.query("SELECT id FROM coach_page_version WHERE coach_id=$1 ORDER BY revision DESC LIMIT 1", [id])).rows[0].id,
      path1 = `/api/coaching/profiles/${id}/${version1}/photo`;
    expect((await candidate.request.get(path1)).status()).toBe(404);
    expect((await anonymous.request.get(path1)).status()).toBe(401);
    await candidate.reload();
    await expect(candidate.getByText(first, { exact: true })).toHaveCount(0);
    expect(
      (
        await candidate.request.post("/api/coach-space/profile", {
          headers: { origin: own.origin },
          multipart: {
            coachId: id,
            basedOn: "0",
            content: JSON.stringify({ presentation: "forbidden", specialties: [], languages: [] }),
            photoAction: "keep",
            locale: "fr",
          },
        })
      ).status(),
    ).toBe(404);
    await admin.goto("/admin/coachs");
    await queueCard(admin).getByRole("button", { name: copy.approve, exact: true }).click();
    await expect(queueCard(admin)).toHaveCount(0);
    const audit = (await database.query("SELECT after FROM back_office_audit WHERE target=$1 AND after->>'versionId'=$2", [id, version1])).rows[0];
    expect(audit.after).toMatchObject({ profileState: "approved", revision: 1 });
    await candidate.reload();
    await expect(candidate.getByText(first, { exact: true })).toBeVisible();
    const portrait = candidate.getByRole("img", { name: photoAlt, exact: true });
    await expect(portrait).toBeVisible();
    await expect.poll(() => portrait.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    const original = await (await candidate.request.get(path1)).body(),
      metadata = await sharp(original).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.exif).toBeUndefined();
    const read = (await (await candidate.request.get("/api/coaching")).json()).coaches.find((coach: { id: string }) => coach.id === id);
    expect(read.profile).toMatchObject({ presentation: first, specialties: ["Reconversion", "Cadres"], languages: ["français", "anglais"] });
    expect(JSON.stringify(read)).not.toContain(email);
    await owner.reload();
    const second = "PRIVATE_PROPOSAL_NOT_VISIBLE : nouvelle présentation et nouvelle photo en attente.";
    const blue = await sharp({ create: { width: 48, height: 64, channels: 3, background: { r: 20, g: 70, b: 190 } } })
      .png()
      .toBuffer();
    await owner.locator('input[type="file"]').setInputFiles({ name: "new-portrait.png", mimeType: "image/png", buffer: blue });
    await save(owner, second);
    const version2 = (await database.query("SELECT id FROM coach_page_version WHERE coach_id=$1 ORDER BY revision DESC LIMIT 1", [id])).rows[0].id;
    await candidate.reload();
    await expect(candidate.getByText(second, { exact: true })).toHaveCount(0);
    await expect(candidate.getByText(first, { exact: true })).toBeVisible();
    expect((await (await candidate.request.get(path1)).body()).equals(original)).toBe(true);
    expect((await candidate.request.get(`/api/coaching/profiles/${id}/${version2}/photo`)).status()).toBe(404);
    const reason = "Merci de préciser vos qualifications sans garantir un résultat.";
    await admin.goto("/admin/coachs");
    await queueCard(admin).getByLabel(copy.reason, { exact: true }).fill(reason);
    await queueCard(admin).getByRole("button", { name: copy.refuse, exact: true }).click();
    await expect
      .poll(() => emailsIn(own.output(), email).some((message) => message.subject === copy.email.refused && message.text.includes(reason)))
      .toBe(true);
    await owner.reload();
    await expect(owner.getByText(reason, { exact: false })).toBeVisible();
    await owner.getByRole("checkbox", { name: copy.removePhoto, exact: true }).check();
    const final = "Présentation corrigée et approuvée, désormais sans portrait publié.";
    await save(owner, final);
    await admin.goto("/admin/coachs");
    await queueCard(admin).getByRole("button", { name: copy.approve, exact: true }).click();
    await expect(queueCard(admin)).toHaveCount(0);
    await candidate.reload();
    await expect(candidate.getByText(final, { exact: true })).toBeVisible();
    await expect(candidate.getByRole("img", { name: photoAlt, exact: true })).toHaveCount(0);
    expect((await candidate.request.get(path1)).status()).toBe(404);
    const exported = await (await owner.request.get("/api/account/export")).json();
    expect(exported.coachPages).toHaveLength(3);
    expect(exported.coachPages.some((p: { photo: unknown }) => p.photo)).toBe(true);
    expect((await owner.request.delete("/api/account", { headers: { origin: own.origin }, data: { email } })).status()).toBe(204);
    expect((await database.query("SELECT id FROM coach_page_version WHERE coach_id=$1", [id])).rows).toHaveLength(0);
    await candidate.reload();
    await expect(candidate.getByRole("heading", { name: NAME, exact: true })).toHaveCount(0);
  } finally {
    await admin.context().close();
    await owner?.context().close();
    await candidate?.context().close();
    await anonymous.close();
  }
});
