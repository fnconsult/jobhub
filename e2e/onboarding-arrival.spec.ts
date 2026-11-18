import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { fromNewAddress, requestSignInLink, setUpTwoStepVerificationIfAsked } from "./support/candidate";
import { emailsTo, linkIn, newAddress, waitForEmail } from "./support/mailbox";
import { forgetTwoStepVerification } from "./support/two-step";

// Issue #1050: a new account is led straight into the « Entretien d'accueil » once signed in, with « Plus tard ».
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
/** An Administrator of the suite's server (ADMIN_EMAILS), signed in by this spec alone. */
const ADMINISTRATOR = "onboarding-arrival-office@e2e.jobbbox.test";

/** Asks a sign-in link for `email` from the sign-in page `page` is on, and opens it: a sign-in of its own. */
async function openSignInLink(page: Page, email: string) {
  const already = emailsTo(email).length;
  await requestSignInLink(page, email);
  await page.goto(linkIn(await waitForEmail(email, already)));
}

/** Signs `email` in afresh, from the sign-in page, in a browser context of its own. */
async function signInElsewhere(page: Page, email: string) {
  await fromNewAddress(page);
  await page.goto("/connexion");
  await openSignInLink(page, email);
}

const conversation = (page: Page) => page.getByRole("region", { name: fr.newProfile.conversation });
const later = (page: Page) => conversation(page).getByRole("button", { name: fr.newProfile.postpone, exact: true });

test.describe("the « Entretien d'accueil » from sign-in on (#1050)", () => {
  test("« Créer mon compte » leads from the landing page through sign-in into the « Entretien d'accueil », « Plus tard » to Mon compte for the session", async ({ page, browser }) => {
    const email = newAddress("accueil-direct");
    await fromNewAddress(page);
    await page.goto("/");
    await page.getByRole("main").getByRole("link", { name: fr.landing.cta }).first().click();
    await expect(page).toHaveURL(`${origin}/connexion?suite=%2Fprofils%2Fnouveau`);
    await openSignInLink(page, email);

    await expect(page).toHaveURL(`${origin}/profils/nouveau`);
    await expect(conversation(page).getByRole("button", { name: fr.newProfile.startQuestionnaire })).toBeVisible();
    await later(page).click();
    await expect(page).toHaveURL(`${origin}/compte`);
    await expect(page.getByRole("link", { name: fr.profiles.create })).toBeVisible();

    // For the rest of the session, neither the home page nor Mon compte lead there again.
    await page.goto("/");
    await expect(page).toHaveURL(`${origin}/`);
    await page.goto("/compte");
    await expect(page).toHaveURL(`${origin}/compte`);

    // Another sign-in of the same account, without a Profile still, is led there again: from Mon compte, sign-in's default.
    const elsewhere = await browser.newContext({ baseURL: origin });
    const other = await elsewhere.newPage();
    await signInElsewhere(other, email);
    await expect(other).toHaveURL(`${origin}/profils/nouveau`);
    await other.goto("/");
    await expect(other).toHaveURL(`${origin}/profils/nouveau`);
    await elsewhere.close();
  });

  test("an account with a Profile, finished or not, is never led there, and « Plus tard » is not offered to it", async ({ page }) => {
    const email = newAddress("accueil-avec-profil");
    await signInElsewhere(page, email);
    await expect(page).toHaveURL(`${origin}/profils/nouveau`);
    // A Profile born during its onboarding and not finished (ADR-0106): its target role and location only.
    const born = await page.request.post("/api/profiles", {
      data: {
        masterCv: { fullName: "Marie Dupont", headline: "", email: "", phone: "", location: "Lyon", summary: "", experience: [], education: [], skills: [], languages: [] },
        searchCriteria: { targetRole: "DAF", locations: ["Lyon"] },
        onboarding: "in_progress",
      },
      headers: { origin },
    });
    expect(born.status(), await born.text()).toBe(201);

    await page.goto("/");
    await expect(page).toHaveURL(`${origin}/`);
    await page.goto("/compte");
    await expect(page).toHaveURL(`${origin}/compte`);
    await page.goto("/profils/nouveau");
    await expect(conversation(page)).toBeVisible();
    await expect(later(page)).toHaveCount(0);
  });

  test("an Administrator without a Profile is not led there", async ({ page }) => {
    await forgetTwoStepVerification(process.env.E2E_DATABASE_URL, ADMINISTRATOR);
    await signInElsewhere(page, ADMINISTRATOR);
    await setUpTwoStepVerificationIfAsked(page);
    await expect(page).toHaveURL(`${origin}/compte`);
    await page.goto("/");
    await expect(page).toHaveURL(`${origin}/`);
  });
});
