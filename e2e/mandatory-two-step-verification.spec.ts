import { readFileSync } from "node:fs";
import { API_VERSION, API_VERSION_HEADER } from "@jobhub/shared";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { fromNewAddress, requestSignInLink, signInWithMagicLink } from "./support/candidate";
import { e2eExtensionDir, unpackedExtensionId } from "./support/extension";
import { codeIn, emailsTo, linkIn, newAddress } from "./support/mailbox";
import { forgetTwoStepVerification, setUpTwoStepVerification, twoStepSetup } from "./support/two-step";

// #665, ADR-0075: Two-step verification is mandatory for Administrators and Human Coaches. After a magic link, such an
// account with no factor yet reaches nothing but its setup and sign-out; a super-admin resets it for someone who lost
// their factors, in the Back Office Audit.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
// In ADMIN_EMAILS (playwright.config.ts): a permanent super-admin is not exempt.
const SUPER_ADMIN = "mandatory-two-step-office@e2e.jobbbox.test";
const SIGN_IN_SUBJECT = "Votre lien de connexion à Jobbbox";
const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Follows a fresh magic link for `email`, as a person does, without setting anything up: where it leads is the test. */
async function followMagicLink(page: Page, email: string) {
  const links = () => emailsTo(email).filter((message) => message.subject === SIGN_IN_SUBJECT);
  const already = links().length;
  await fromNewAddress(page);
  await page.goto("/connexion");
  await requestSignInLink(page, email);
  await expect.poll(() => links().length).toBeGreaterThan(already);
  await page.goto(linkIn(links()[already]!));
}

/** A page of its own (cookies apart), as for another person on another computer, in French. */
async function newPerson(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ baseURL: origin, locale: "fr-FR" });
  return context.newPage();
}

/** What a session reaches before its setup is done: the setup alone, on the server, for the web, the API and the extension. */
async function expectOnlyTheSetup(page: Page, back: string) {
  await expect(page).toHaveURL(`${origin}/connexion/deuxieme-etape?suite=${encodeURIComponent(back)}`);
  await expect(page.getByRole("heading", { level: 1, name: fr.twoStep.secondStep.title })).toBeVisible();
  await expect(twoStepSetup(page).getByText(fr.twoStep.setup.intro)).toBeVisible();
  const refused = await page.request.get("/api/profiles");
  expect(refused.status()).toBe(401);
  expect(await refused.json()).toEqual({ error: "second_step_required" });
  const extensionOrigin = `chrome-extension://${unpackedExtensionId(e2eExtensionDir)}`;
  const fromExtension = await page.request.get("/api/profiles", { headers: { origin: extensionOrigin, [API_VERSION_HEADER]: String(API_VERSION) } });
  expect(fromExtension.status()).toBe(401);
  expect(await fromExtension.json()).toEqual({ error: "second_step_required" });
}

test.describe("Mandatory Two-step verification (#665)", () => {
  // #686, ADR-0075: the second step applies after the sign-in email's code as after its link.
  test("a super-admin signed in with the email's code has a pending session: only the setup is reached", async ({ page }) => {
    await forgetTwoStepVerification(process.env.E2E_DATABASE_URL, SUPER_ADMIN);
    const links = () => emailsTo(SUPER_ADMIN).filter((message) => message.subject === SIGN_IN_SUBJECT);
    const already = links().length;
    await fromNewAddress(page);
    await page.goto("/connexion");
    await requestSignInLink(page, SUPER_ADMIN);
    await expect.poll(() => links().length).toBeGreaterThan(already);
    await page.getByLabel(fr.signIn.codeLabel).fill(codeIn(links()[already]!));
    await page.getByRole("button", { name: fr.signIn.codeSubmit }).click();

    await expectOnlyTheSetup(page, "/compte");
    await page.goto("/admin");
    await expectOnlyTheSetup(page, "/admin");
  });

  test("an ADMIN_EMAILS super-admin signed in by magic link sets it up before anything else, then reaches /admin, and cannot turn it off", async ({ page }) => {
    await forgetTwoStepVerification(process.env.E2E_DATABASE_URL, SUPER_ADMIN);
    await followMagicLink(page, SUPER_ADMIN);
    await expectOnlyTheSetup(page, "/compte");

    // Any other page sends it back to the setup, the Back Office first.
    await page.goto("/admin");
    await expectOnlyTheSetup(page, "/admin");

    await setUpTwoStepVerification(page);
    await expect(page).toHaveURL(`${origin}/admin`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.admin.dashboard.title);
    await expect.poll(() => emailsTo(SUPER_ADMIN).map((message) => message.subject)).toContain("Vérification en deux étapes activée");

    // Mon compte, « Sécurité »: on, with no « Désactiver », and why; the endpoint refuses too.
    await page.goto("/compte/securite");
    const section = page.getByRole("region", { name: fr.twoStep.security.title });
    await expect(section.getByRole("status")).toHaveText(/^Activée depuis le /);
    await expect(section.getByText(fr.twoStep.security.mandatory)).toBeVisible();
    await expect(section.getByRole("button", { name: fr.twoStep.security.disable })).toHaveCount(0);
    await expect(section.getByRole("button", { name: fr.twoStep.security.regenerate })).toBeVisible();
    const disabled = await page.request.delete("/api/account/two-step-verification", { headers: { origin } });
    expect(disabled.status()).toBe(403);
    expect(await disabled.json()).toEqual({ error: "mandatory" });

    // The Administrateurs page says it is on.
    await page.goto("/admin/administrateurs");
    const row = page.getByRole("row").filter({ hasText: SUPER_ADMIN });
    await expect(row).toContainText(fr.admin.administrators.twoStepOn);
  });

  test("a Human Coach signed in by magic link sets it up before the Espace coach", async ({ page, browser }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    const coachEmail = newAddress("mandatory-two-step-coach");
    await page.goto("/admin/coachs");
    const name = `Léa Coach ${unique()}`;
    await page.getByLabel(fr.admin.humanCoaches.name).fill(name);
    await page.getByLabel(fr.admin.humanCoaches.email).fill(coachEmail);
    await page.getByLabel(fr.admin.humanCoaches.bookingUrl).fill(`https://cal.com/lea-${unique()}/seance`);
    await page.getByRole("button", { name: fr.admin.humanCoaches.add }).click();
    await expect(page.getByRole("status")).toHaveText(tr(fr.admin.humanCoaches.added, { name }));

    const coach = await newPerson(browser);
    await followMagicLink(coach, coachEmail);
    await expectOnlyTheSetup(coach, "/compte");
    await coach.goto("/espace-coach");
    await expectOnlyTheSetup(coach, "/espace-coach");
    await setUpTwoStepVerification(coach);
    await expect(coach).toHaveURL(`${origin}/espace-coach/contrat`);
    await expect(coach.getByRole("heading", { level: 1 })).toHaveText(fr.coachSpaceV2.pages.contrat);
    await expect(coach.getByText(fr.coachEnrolment.awaitingContract)).toBeVisible();

    await coach.context().close();
  });

  test("a super-admin resets an Administrator's Two-step verification: factors and sessions gone, emailed, in the Back Office Audit", async ({ page, browser }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    // An Administrator who set it up, then lost their phone and their backup codes.
    const email = newAddress("mandatory-two-step-support");
    const person = await newPerson(browser);
    await followMagicLink(person, email);
    await expect(person).toHaveURL(`${origin}/compte`);
    await page.goto("/admin/administrateurs");
    await page.getByLabel(fr.admin.administrators.grantEmail).fill(email);
    await page.getByRole("checkbox", { name: fr.admin.roles.support }).check();
    await page.getByRole("button", { name: fr.admin.administrators.grant }).click();
    await expect(page.getByRole("status")).toBeVisible();
    // Given a role while signed in: their next page asks for the setup first.
    await person.goto("/admin");
    await expectOnlyTheSetup(person, "/admin");
    await setUpTwoStepVerification(person);
    await expect(person.getByRole("heading", { level: 1 })).toHaveText(fr.admin.dashboard.title);

    // Support's roles do not reach the reset: the page is not found, and the denial is recorded like any other.
    expect((await person.goto("/admin/administrateurs"))?.status()).toBe(404);

    // The super-admin resets it, a box ticked to confirm.
    await page.goto("/admin/administrateurs");
    const reset = page.getByRole("form", { name: fr.admin.administrators.reset.title });
    await reset.getByLabel(fr.admin.administrators.reset.email).fill(email);
    const confirm = reset.getByRole("checkbox", { name: fr.admin.administrators.reset.confirm });
    await expect(confirm).toHaveAttribute("required", "");
    await confirm.check();
    await reset.getByRole("button", { name: fr.admin.administrators.reset.submit }).click();
    await expect(page.getByRole("status")).toHaveText(fr.admin.administrators.reset.done);
    await expect(page.getByRole("row").filter({ hasText: email })).toContainText(fr.admin.administrators.twoStepNone);

    // Their session is gone, and they are told.
    await person.goto("/admin");
    await expect(person).toHaveURL(/\/connexion\/back-office/);
    await expect.poll(() => emailsTo(email).map((message) => message.subject)).toContain("Vérification en deux étapes réinitialisée");
    // Their next magic link asks them to set it up again.
    await followMagicLink(person, email);
    await expectOnlyTheSetup(person, "/compte");

    // Activité › Actions des administrateurs: who, when, which account; and Support's denial.
    await page.goto("/admin/activite/actions");
    const entry = page.getByRole("row").filter({ hasText: email }).filter({ hasText: fr.admin.journal.actions.reset });
    await expect(entry).toHaveCount(1);
    await expect(entry).toContainText(SUPER_ADMIN);
    await expect(entry).toContainText(fr.admin.journal.sections.roles);
    const denied = page.getByRole("row").filter({ hasText: email }).filter({ hasText: fr.admin.journal.actions.denied });
    await expect(denied.first()).toBeVisible();

    await person.context().close();
  });
});
