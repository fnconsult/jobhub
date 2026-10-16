import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #203: every change made in the Back Office is recorded in the Back Office
// Audit, which Administrators read on the Journal page, newest first, by section.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const journal = fr.admin.journal;
// Its own Administrator: two sign-ins of one address at once can pick up each other's link.
const ADMINISTRATOR = "journal-office@e2e.jobbbox.test";

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");

test.describe("the Back Office Journal", () => {
  test("is hidden from Candidates", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("curious"));
    for (const path of ["/admin/journal", "/admin/journal?section=plan_quotas"]) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.notFound.title);
      await expect(page).toHaveTitle(`${fr.notFound.title} · ${fr.app.name}`);
    }
  });

  test("lists the changes Administrators made, newest first, and by section", async ({ page }) => {
    await signInWithMagicLink(page, ADMINISTRATOR);
    const name = `Sophie Martin ${unique()}`;
    const email = newAddress("journal-coach");

    // Add a Human Coach, then retire them.
    await page.goto("/admin/coachs");
    await page.getByLabel(fr.admin.humanCoaches.name).fill(name);
    await page.getByLabel(fr.admin.humanCoaches.email).fill(email);
    await page.getByLabel(fr.admin.humanCoaches.bookingUrl).fill(`https://cal.com/sophie-${unique()}/seance`);
    await page.getByRole("button", { name: fr.admin.humanCoaches.add }).click();
    await expect(page.getByRole("status")).toHaveText(tr(fr.admin.humanCoaches.added, { name }));
    await page.getByRole("button", { name: tr(fr.admin.humanCoaches.retire, { name }) }).click();
    await expect(page.getByRole("status")).toHaveText(fr.admin.humanCoaches.retired);

    // Save the Premium Plan's quotas as they are (other tests rely on them).
    await page.goto("/admin/quotas");
    await page.getByRole("button", { name: "Enregistrer l'offre Premium" }).click();
    await expect(page.getByRole("status")).toHaveText("Quotas de l'offre Premium enregistrés.");

    await page.goto("/admin");
    await page.getByRole("link", { name: fr.admin.sections.journal }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(journal.title);
    await expect(page).toHaveTitle(`${journal.title} · ${fr.admin.title}`);

    const coachRows = page.getByRole("row").filter({ hasText: email });
    await expect(coachRows).toHaveCount(2);
    await expect(coachRows.nth(0)).toContainText(journal.actions.retired);
    await expect(coachRows.nth(1)).toContainText(journal.actions.added);
    for (const row of [coachRows.nth(0), coachRows.nth(1)]) {
      await expect(row).toContainText(ADMINISTRATOR);
      await expect(row).toContainText(journal.sections.human_coaches);
    }
    await expect(coachRows.nth(1)).toContainText(tr(journal.set, { field: fr.admin.humanCoaches.name, after: name }));
    const premium = page.getByRole("row").filter({ hasText: ADMINISTRATOR }).filter({ hasText: fr.billing.plans.premium }).first();
    await expect(premium).toContainText(journal.unchanged);

    const nav = page.getByRole("navigation", { name: journal.filter });
    await nav.getByRole("link", { name: journal.sections.human_coaches }).click();
    await expect(page).toHaveURL(/\/admin\/journal\?section=human_coaches$/);
    await expect(nav.getByRole("link", { name: journal.sections.human_coaches })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("row").filter({ hasText: email })).toHaveCount(2);
    await expect(page.getByRole("row").filter({ hasText: journal.sections.plan_quotas })).toHaveCount(0);

    await nav.getByRole("link", { name: journal.sections.plan_quotas }).click();
    await expect(page.getByRole("row").filter({ hasText: email })).toHaveCount(0);
    await expect(page.getByRole("row").filter({ hasText: ADMINISTRATOR }).filter({ hasText: fr.billing.plans.premium }).first()).toBeVisible();
  });
});
