import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Issue #338 (ADR-0064): the Recipient list, « Destinataires des données », a public page of Légal generated from the
// Tool catalog at each request: Jobbbox's Host, then each Tool switched on that receives personal data, or queries
// drawn from it, with what it is for, what it receives, its contracting entity, its place and its transfer safeguard.
// The suite's server (playwright.config.ts) has Mistral, Perplexity, Stripe and Google sign-in switched on, and no
// Claude key: Claude is not listed.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const en = JSON.parse(readFileSync("packages/shared/src/i18n/locales/en.json", "utf8"));

const recipient = (page: Page, name: string) => page.getByRole("region", { name: new RegExp(`^${name}`) });

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => node.target.join(" ")) }))).toEqual([]);
}

test.describe("Destinataires des données (#338)", () => {
  test("lists the Host and the recipients switched on, each with its facts, and the day the list last changed", async ({ page }) => {
    await page.goto("/legal/destinataires");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.recipientList.title);
    await expect(page.getByText(/^Dernière modification le \d{1,2} \S+ \d{4}$/)).toBeVisible();

    const names = await page.getByRole("heading", { level: 2 }).evaluateAll((all) => all.map((heading) => heading.firstChild?.textContent));
    expect(names[0]).toBe("Hostinger");
    expect(names).toEqual(expect.arrayContaining(["Mistral AI", "Perplexity", "Stripe", "Google"]));
    // No Claude key on the suite's server: Claude cannot be called, so it is not a recipient; nor GitHub, which receives no personal data.
    expect(names).not.toContain("Claude (Anthropic)");
    expect(names).not.toContain("GitHub");

    const mistral = recipient(page, "Mistral AI");
    await expect(mistral.getByText(fr.recipientList.residency.eu, { exact: true })).toBeVisible();
    await expect(mistral).toContainText("Mistral AI SAS");
    await expect(mistral).toContainText("Votre identité (nom, coordonnées), seulement si vous avez donné votre consentement IA UE.");
    const perplexity = recipient(page, "Perplexity");
    await expect(perplexity.getByText(fr.recipientList.residency.outside_eu, { exact: true })).toBeVisible();
    await expect(perplexity).toContainText("Des requêtes seulement : un métier, un lieu ou le nom d'un employeur, jamais votre identité.");
    await expect(perplexity).toContainText("Non établie à ce jour.");

    // Marked as Légal's page in its left column; the way back to « IA dans Jobbbox ».
    await expect(page.getByRole("navigation", { name: fr.legal.documentsNav }).getByRole("link", { name: fr.recipientList.title })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("link", { name: fr.recipientList.policy })).toHaveAttribute("href", "/legal/confidentialite#ia");
    await expectNoAxeViolations(page);
  });

  test("is in English under /en, with the same recipients", async ({ page }) => {
    await page.goto("/en/legal/destinataires");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(en.recipientList.title);
    await expect(page.getByText(/^Last changed on /)).toBeVisible();
    const stripe = recipient(page, "Stripe");
    await expect(stripe).toContainText("Stripe Payments Europe, Limited");
    await expect(stripe).toContainText("Payment of your subscriptions and coaching sessions. Stripe also processes this data for its own obligations");
    await expect(stripe).toContainText("The EU–U.S. Data Privacy Framework, which the provider declares it adheres to.");
    await expectNoAxeViolations(page);
  });

  test("is reached from the privacy policy, not from the footer", async ({ page }) => {
    await page.goto("/legal/confidentialite");
    await page.getByRole("main").getByRole("link", { name: fr.recipientList.fromPolicy }).click();
    await expect(page).toHaveURL(/\/legal\/destinataires$/);
    await expect(page.getByRole("contentinfo").getByRole("link", { name: fr.recipientList.title })).toHaveCount(0);
  });
});
