import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { MARIE_DUPONT_CV, pdfCv } from "../apps/web/src/cv/test-support";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { readCv, throughCvInterview } from "./support/onboarding-summary";

// Issue #121 / ADR-0007 amendment: the Candidate gives (and can withdraw) an explicit,
// dated EU AI consent on their account page. With it, their identity-bearing AI calls go to Mistral.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
const CV = { name: "CV-Marie-Dupont.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdfCv(MARIE_DUPONT_CV)) };
const threadOf = (page: Page) => page.getByRole("list", { name: fr.questionnaire.transcript });
const suggestionsOf = (page: Page) => page.getByRole("group", { name: fr.conversationFirst.suggestions });

test.describe("EU AI consent", () => {
  test("the Candidate gives EU AI consent on their account page, sees its date, and can withdraw it", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("eu-ai-consent"));
    await page.goto("/compte/ia-europeenne");
    const consent = page.getByRole("region", { name: fr.euAiConsent.title });
    await expect(consent.getByRole("status")).toHaveText(fr.euAiConsent.notGiven);

    await consent.getByRole("button", { name: fr.euAiConsent.give }).click();
    await expect(consent.getByRole("status")).toHaveText(/^Accord donné le \d{1,2}(er)? \S+ \d{4}\.$/);

    await page.reload();
    await expect(consent.getByRole("status")).toHaveText(/^Accord donné le /);

    await consent.getByRole("button", { name: fr.euAiConsent.withdraw }).click();
    await expect(consent.getByRole("status")).toHaveText(fr.euAiConsent.notGiven);
    await page.reload();
    await expect(consent.getByRole("status")).toHaveText(fr.euAiConsent.notGiven);
    await expect(consent.getByRole("button", { name: fr.euAiConsent.give })).toBeVisible();
  });

  test("only a signed-in Candidate can give or withdraw EU AI consent", async ({ request }) => {
    expect((await request.put("/api/account/eu-ai-consent", { headers: { origin } })).status()).toBe(401);
    expect((await request.delete("/api/account/eu-ai-consent", { headers: { origin } })).status()).toBe(401);
  });

  // Issue #1052: on « Créer un profil », the EU AI Consent is proposed in the thread once the CV is chosen and before it
  // leaves for the AI, in the first sentence of this page's validated text; « Donner mon accord » and « Pas maintenant ».
  test.describe("proposed before the CV is read on « Créer un profil » (#1052)", () => {
    test("given there, it is the same dated consent as on the account page, where it is withdrawn", async ({ page }) => {
      await signInWithMagicLink(page, newAddress("eu-ai-consent-onboarding"));
      await page.goto("/profils/nouveau");
      await page.waitForLoadState("networkidle");
      await page.getByLabel(fr.cvUpload.fileLabel).setInputFiles(CV);
      await page.getByRole("button", { name: fr.cvUpload.submit, exact: true }).click();

      await expect(threadOf(page).getByText(fr.euAiConsent.offer, { exact: true })).toBeVisible();
      const give = suggestionsOf(page).getByRole("button", { name: fr.euAiConsent.give, exact: true });
      const notNow = suggestionsOf(page).getByRole("button", { name: fr.euAiConsent.notNow, exact: true });
      await expect(give).toBeVisible();
      await expect(notNow).toBeVisible();
      // Two choices of the same weight, neither pre-selected.
      expect(await give.getAttribute("class")).toBe(await notNow.getAttribute("class"));
      await expect(give).not.toBeFocused();
      await expect(notNow).not.toBeFocused();
      // Nothing read before the answer.
      await expect(threadOf(page).getByText(fr.newProfile.fromCv.reading)).toHaveCount(0);

      await give.click();
      await expect(threadOf(page).getByText(fr.newProfile.fromCv.questionsStart)).toBeVisible({ timeout: 15_000 });

      await page.goto("/compte/ia-europeenne");
      const consent = page.getByRole("region", { name: fr.euAiConsent.title });
      await expect(consent.getByRole("status")).toHaveText(/^Accord donné le \d{1,2}(er)? \S+ \d{4}\.$/);
      await consent.getByRole("button", { name: fr.euAiConsent.withdraw }).click();
      await expect(consent.getByRole("status")).toHaveText(fr.euAiConsent.notGiven);
    });

    test("« Pas maintenant » reads the CV as before and records no consent", async ({ page }) => {
      await signInWithMagicLink(page, newAddress("eu-ai-consent-not-now"));
      await page.goto("/profils/nouveau");
      await page.waitForLoadState("networkidle");
      await page.getByLabel(fr.cvUpload.fileLabel).setInputFiles(CV);
      await readCv(page, "notNow");
      await expect(threadOf(page).getByText(fr.newProfile.fromCv.questionsStart)).toBeVisible({ timeout: 15_000 });

      await page.goto("/compte/ia-europeenne");
      await expect(page.getByRole("region", { name: fr.euAiConsent.title }).getByRole("status")).toHaveText(fr.euAiConsent.notGiven);
    });

    test("is not proposed again once refused during this onboarding", async ({ page }) => {
      await signInWithMagicLink(page, newAddress("eu-ai-consent-refused"));
      await page.goto("/profils/nouveau");
      await page.waitForLoadState("networkidle");
      await page.getByLabel(fr.cvUpload.fileLabel).setInputFiles(CV);
      await readCv(page, "notNow");
      await expect(threadOf(page).getByText(fr.newProfile.fromCv.questionsStart)).toBeVisible({ timeout: 15_000 });

      await throughCvInterview(page);
      await suggestionsOf(page).getByRole("button", { name: fr.cvReview.startOver, exact: true }).click();
      await page.getByLabel(fr.cvUpload.fileLabel).setInputFiles(CV);
      await readCv(page, null);
      await expect(threadOf(page).getByText(fr.newProfile.fromCv.questionsStart)).toBeVisible({ timeout: 15_000 });
      await expect(threadOf(page).getByText(fr.euAiConsent.offer, { exact: true })).toHaveCount(0);
      await expect(suggestionsOf(page).getByRole("button", { name: fr.euAiConsent.give, exact: true })).toHaveCount(0);
    });

    test("is not proposed to a Candidate who has already consented", async ({ page }) => {
      await signInWithMagicLink(page, newAddress("eu-ai-consent-already"));
      expect((await page.request.put("/api/account/eu-ai-consent", { headers: { origin } })).ok()).toBe(true);
      await page.goto("/profils/nouveau");
      await page.waitForLoadState("networkidle");
      await page.getByLabel(fr.cvUpload.fileLabel).setInputFiles(CV);
      await readCv(page, null);

      await expect(threadOf(page).getByText(fr.newProfile.fromCv.questionsStart)).toBeVisible({ timeout: 15_000 });
      await expect(threadOf(page).getByText(fr.euAiConsent.offer, { exact: true })).toHaveCount(0);
      await expect(suggestionsOf(page).getByRole("button", { name: fr.euAiConsent.notNow, exact: true })).toHaveCount(0);
    });
  });
});
