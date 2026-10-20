import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #121 / ADR-0007 amendment: the Candidate gives (and can withdraw) an explicit,
// dated EU AI consent on their account page. With it, their identity-bearing AI calls go to Mistral.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;

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
});
