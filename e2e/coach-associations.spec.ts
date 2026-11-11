import { migrateCoachPages } from "../apps/web/src/coach-pages";
import path from "node:path";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { startOwnServer, signInByEmail, type OwnServer } from "./support/own-server";
import { requestSignInLink, setUpTwoStepVerificationIfAsked, fromNewAddress } from "./support/candidate";
import { emailsIn, linkIn, newAddress } from "./support/mailbox";
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8")),
  copy = fr.association;
let own: OwnServer, database: Pool;
async function signedIn(browser: Browser, email: string) {
  const page = await (await browser.newContext({ baseURL: own.origin, locale: "fr-FR" })).newPage();
  await signInByEmail(page, own, email);
  return page;
}
async function acceptContract(page: Page) {
  await setUpTwoStepVerificationIfAsked(page);
  await page.getByRole("checkbox", { name: fr.coachContract.agree.replace("{{version}}", "2026-01-01") }).check();
  await page.getByRole("button", { name: fr.coachContract.accept, exact: true }).click();
}
async function makeAssociation(page: Page, email: string, siret: string) {
  const person = (await database.query("SELECT id FROM candidate WHERE email=$1", [email])).rows[0];
  const id = (
    await database.query("INSERT INTO coach_association(name,legal_status,siret) VALUES('Transitions Association','Association loi 1901',$1) RETURNING id", [
      siret,
    ])
  ).rows[0].id;
  await database.query("INSERT INTO coach_association_manager VALUES($1,$2)", [id, person.id]);
  await page.goto("/espace-association");
  await expect(page).toHaveURL(/espace-coach\/contrat$/);
  await acceptContract(page);
  await expect(page).toHaveURL(new RegExp(`/espace-association/${id}/coachs$`));
  return id;
}
test.beforeAll(async () => {
  own = await startOwnServer(876, "coach_associations", {
    JOBHUB_TARGET: "e2e",
    JOBHUB_IGNORE_ROOT_ENV: "1",
    AUTH_SECRET: "e2e-association-secret-e2e-association-secret",
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
});
test.afterAll(async () => {
  await database?.end();
  await own?.stop();
});
test("invite, explicitly join, accept the contract, scope the offer, refuse every Candidate route, then retire globally with history kept", async ({
  browser,
}) => {
  test.setTimeout(180000);
  const managerEmail = newAddress("association-owner"),
    coachEmail = newAddress("association-invited-coach"),
    manager = await signedIn(browser, managerEmail);
  const recipient = await (await browser.newContext({ baseURL: own.origin, locale: "fr-FR" })).newPage();
  let candidate: Page | undefined;
  try {
    const id = await makeAssociation(manager, managerEmail, "12345678901234");
    for (const width of [1280, 390]) {
      await manager.setViewportSize({ width, height: 900 });
      await manager.goto(`/espace-association/${id}/coachs`);
      expect(await manager.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(manager.getByRole("link", { name: fr.coachSpaceV2.pages.candidates, exact: true })).toHaveCount(0);
    }
    await manager.setViewportSize({ width: 1280, height: 900 });
    const form = manager.locator("form").filter({ has: manager.getByRole("heading", { name: copy.inviteCoach, exact: true }) });
    await form.getByLabel(copy.name, { exact: true }).fill("Invited Sophie");
    await form.getByLabel(copy.emailAddress, { exact: true }).fill(coachEmail);
    await form.getByRole("button", { name: copy.invite, exact: true }).click();
    await expect(manager.getByRole("status")).toHaveText(copy.invited);
    await expect.poll(() => emailsIn(own.output(), coachEmail).length).toBe(1);
    const url = linkIn(emailsIn(own.output(), coachEmail)[0]!);
    expect((await database.query("SELECT id FROM human_coach WHERE email=$1", [coachEmail])).rows).toHaveLength(0);
    await fromNewAddress(recipient);
    await recipient.goto(url);
    await expect(recipient).toHaveURL(/connexion/);
    const before = emailsIn(own.output(), coachEmail).length;
    await requestSignInLink(recipient, coachEmail);
    await expect.poll(() => emailsIn(own.output(), coachEmail).length).toBeGreaterThan(before);
    await recipient.goto(linkIn(emailsIn(own.output(), coachEmail)[before]!));
    await expect(recipient.getByRole("button", { name: copy.acceptInvitation, exact: true })).toBeVisible();
    expect((await database.query("SELECT id FROM human_coach WHERE email=$1", [coachEmail])).rows).toHaveLength(0);
    expect((await manager.request.get(url)).status()).toBe(404);
    const forged = new URL(url);
    forged.searchParams.set("token", "0".repeat(64));
    expect((await recipient.request.get(forged.toString())).status()).toBe(404);
    await recipient.getByRole("button", { name: copy.acceptInvitation, exact: true }).click();
    await setUpTwoStepVerificationIfAsked(recipient);
    await expect(recipient).toHaveURL(/espace-coach\/contrat$/);
    await acceptContract(recipient);
    await expect(recipient).toHaveURL(/espace-coach\/aujourdhui$/);
    const coachId = (await database.query("SELECT id FROM human_coach WHERE email=$1 AND retired_at IS NULL", [coachEmail])).rows[0].id;
    // Downstream public-profile approval (#877) is a fixture here, not an Association permission.
    await database.query("UPDATE human_coach SET public_ready=true WHERE id=$1", [coachId]);
    await migrateCoachPages(database);
    candidate = await signedIn(browser, newAddress("association-private-candidate"));
    const candidateEmail = (await (await candidate.request.get("/api/account/export")).json()).account.email;
    const candidateRow = (await database.query("SELECT id,email FROM candidate WHERE email=$1", [candidateEmail])).rows[0];
    const sessionId = (
      await database.query(
        "INSERT INTO coaching_session(candidate_id,coach_id,stripe_checkout_session_id,amount,currency) VALUES($1,$2,'cs-association-past',9000,'eur') RETURNING id",
        [candidateRow.id, coachId],
      )
    ).rows[0].id;
    const privateNote = "PRIVATE_CANDIDATE_NOTE_ASSOCIATION_MUST_NEVER_READ";
    await database.query("INSERT INTO private_coach_note(coach_id,candidate_id,text) VALUES($1,$2,$3)", [coachId, candidateRow.id, privateNote]);
    await manager.goto(`/espace-association/${id}/offres`);
    const offer = manager.locator("form").filter({ has: manager.getByRole("heading", { name: "Invited Sophie", exact: true }) });
    await offer.getByLabel(copy.seller, { exact: true }).selectOption("association");
    await offer.getByLabel(copy.duration, { exact: true }).fill("90");
    await offer.getByLabel(copy.amount, { exact: true }).fill("125");
    await offer.getByRole("button", { name: copy.save, exact: true }).click();
    await expect(manager.getByRole("status")).toHaveText(copy.offerSaved);
    const sold = (
      await database.query(
        "SELECT o.amount,o.duration_minutes,s.association_id,s.commission_bps FROM coaching_offer o JOIN coaching_seller s ON s.id=o.seller_id WHERE o.coach_id=$1",
        [coachId],
      )
    ).rows[0];
    expect(sold).toEqual({ amount: 12500, duration_minutes: 90, association_id: id, commission_bps: 0 });
    await candidate.goto("/coachs");
    await expect(candidate.getByText(copy.proposedBy.replace("{{name}}", "Transitions Association"), { exact: true })).toBeVisible();
    expect(await (await manager.request.get("/api/coach-space")).json()).toEqual({ humanCoach: false, associationSpace: true });
    for (const route of [
      "/espace-coach",
      "/espace-coach/aujourdhui",
      "/espace-coach/candidates",
      `/espace-coach/candidates/${candidateRow.id}`,
      "/espace-coach/seances",
      `/espace-coach/seances/${sessionId}`,
      `/espace-coach/${candidateRow.id}`,
      `/espace-coach/${candidateRow.id}/candidatures/00000000-0000-4000-8000-000000000001`,
    ]) {
      const response = await manager.request.get(route),
        body = await response.text();
      expect(body, route).not.toContain(privateNote);
      expect(body, route).not.toContain(candidateRow.email);
      expect(new URL(response.url()).pathname, route).toBe("/espace-coach/contrat");
    }
    for (const [method, route] of [
      ["PUT", `/api/coach-space/candidates/${candidateRow.id}/notes`],
      ["PATCH", `/api/coach-space/sessions/${sessionId}`],
      ["POST", `/api/coach-space/sessions/${sessionId}/cancel`],
      ["POST", "/api/coach-space/reports"],
      ["PUT", "/api/coach-space/contact"],
      ["PUT", "/api/coach-space/time-zone"],
    ]) {
      expect((await manager.request.fetch(route!, { method: method!, headers: { origin: own.origin }, data: { text: "forbidden" } })).status(), route).toBe(
        404,
      );
    }
    const reading = await (await manager.request.get("/api/coaching/shared-reading")).json();
    expect(reading.sessions).toEqual([]);
    expect((await manager.request.get(`/api/coaching/shared-reading/${sessionId}`)).status()).toBe(404);
    for (const page of ["coachs", "offres", "revenus", "membres"]) {
      const response = await manager.request.get(`/espace-association/${id}/${page}`);
      expect(response.ok()).toBe(true);
      expect(await response.text()).not.toContain(privateNote);
    }
    await manager.goto(`/espace-association/${id}/coachs`);
    await manager.getByRole("link", { name: fr.coachSpaceV2.pages.contrat, exact: true }).click();
    await expect(manager.getByRole("link", { name: copy.pages.coachs, exact: true })).toBeVisible();
    await expect(manager.getByRole("link", { name: fr.coachSpaceV2.pages.candidates, exact: true })).toHaveCount(0);
    const data = await (await manager.request.get("/api/account/export")).json();
    expect(JSON.stringify(data.associationActivity)).not.toContain(coachEmail);
    expect(JSON.stringify(data.associationActivity)).not.toContain(privateNote);
    await manager.goto(`/espace-association/${id}/coachs`);
    await manager.getByRole("button", { name: copy.retireCoach.replace("{{name}}", "Invited Sophie"), exact: true }).click();
    await expect(manager.getByRole("status")).toHaveText(copy.coachRetired);
    expect((await recipient.goto("/espace-coach/aujourdhui"))?.status()).toBe(404);
    expect((await database.query("SELECT id FROM coaching_session WHERE id=$1", [sessionId])).rows).toHaveLength(1);
    await candidate.goto("/coachs");
    await expect(candidate.getByRole("heading", { name: "Invited Sophie", exact: true })).toHaveCount(0);
  } finally {
    await manager.context().close();
    await recipient.context().close();
    await candidate?.context().close();
  }
});
test("a member invitation grants only its Association after contract acceptance and no access to another Association", async ({ browser }) => {
  const email = newAddress("association-founder-two"),
    manager = await signedIn(browser, email),
    memberEmail = newAddress("association-member"),
    member = await signedIn(browser, memberEmail);
  try {
    const id = await makeAssociation(manager, email, "12345678901235");
    await manager.goto(`/espace-association/${id}/membres`);
    const form = manager.locator("form").filter({ has: manager.getByRole("heading", { name: copy.inviteMember, exact: true }) });
    await form.getByLabel(copy.name, { exact: true }).fill("Association colleague");
    await form.getByLabel(copy.emailAddress, { exact: true }).fill(memberEmail);
    await form.getByRole("button", { name: copy.invite, exact: true }).click();
    await expect
      .poll(() => emailsIn(own.output(), memberEmail).some((message) => message.subject === copy.email.subject.replace("{{name}}", "Transitions Association")))
      .toBe(true);
    const message = emailsIn(own.output(), memberEmail).find(
      (message) => message.subject === copy.email.subject.replace("{{name}}", "Transitions Association"),
    )!;
    await member.goto(linkIn(message));
    await member.getByRole("button", { name: copy.acceptInvitation, exact: true }).click();
    await expect(member).toHaveURL(/espace-coach\/contrat$/);
    await acceptContract(member);
    await expect(member).toHaveURL(new RegExp(`/espace-association/${id}/coachs$`));
    expect((await database.query("SELECT id FROM human_coach WHERE email=$1", [memberEmail])).rows).toHaveLength(0);
    const other = (await database.query("SELECT id FROM coach_association WHERE id<>$1 LIMIT 1", [id])).rows[0].id;
    for (const route of ["coachs", "offres", "revenus", "membres"]) {
      expect((await member.request.get(`/espace-association/${other}/${route}`)).status()).toBe(404);
    }
    const exported = await (await member.request.get("/api/account/export")).json();
    expect(exported.associationActivity.invitationsReceived).toEqual([expect.objectContaining({ role: "manager", email: memberEmail })]);
    expect((await member.request.delete("/api/account", { headers: { origin: own.origin }, data: { email: memberEmail } })).status()).toBe(204);
    expect((await database.query("SELECT id FROM coach_association_invitation WHERE email=$1", [memberEmail])).rows).toHaveLength(0);
    expect(
      (await database.query("SELECT 1 FROM coach_association_manager m JOIN candidate c ON c.id=m.candidate_id WHERE c.email=$1", [memberEmail])).rows,
    ).toHaveLength(0);
  } finally {
    await manager.context().close();
    await member.context().close();
  }
});
