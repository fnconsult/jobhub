import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// The sidebar's Usage Meter (ADR-0032): the week's Plan Quotas as one bar, each weighed by
// what the Plan grants; its button shows each quota's use, and leads to the subscription page.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;

const meterButton = (page: Page) => page.getByRole("button", { name: new RegExp(`^${fr.usageMeter.title}`) });
const detailRow = (page: Page, quota: string) => page.locator(".usage-meter-detail:visible dl > div").filter({ has: page.getByText(quota, { exact: true }) }).locator("dd");

async function useOneMatchScore(page: Page) {
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const captured = await page.request.post("/api/job-offers", {
    data: { source: { url: `https://www.apec.fr/offres/daf-${tag}` }, title: "DAF H/F", content: `DAF pour un groupe industriel (réf. ${tag}).`, location: "Lyon" },
    headers: { origin },
  });
  expect(captured.status(), await captured.text()).toBe(200);
  const cv = { fullName: "Marie Dupont", headline: "DAF", email: "", phone: "", location: "Lyon", summary: "", experience: [], education: [], skills: ["IFRS"], languages: [] };
  const scored = await page.request.post("/api/match-score", { data: { jobOfferId: (await captured.json()).id, cv }, headers: { origin } });
  expect(scored.status(), await scored.text()).toBe(200);
}

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
]) {
  test.describe(`the Usage Meter in the sidebar (${viewport.name})`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("fills with the week's uses over what the Plan grants, and shows each quota on demand", async ({ page }) => {
      await signInWithMagicLink(page, newAddress(`usage-meter-${viewport.name}`));
      await useOneMatchScore(page);
      await page.goto("/candidatures");
      if (viewport.width < 1024) await page.getByRole("button", { name: fr.sidebar.menu, exact: true }).click();

      // Free: 1 Match Score, 1 ATS Score and 1 Job Search a week; the Match Score computed weighs 1 of 3.
      const bar = page.getByRole("progressbar", { name: fr.usageMeter.title });
      await expect(bar).toHaveAttribute("aria-valuenow", "33");
      await expect(bar).toHaveAttribute("aria-valuetext", "1 sur 3 utilisés (33 %)");
      const button = meterButton(page);
      await expect(button).toHaveAttribute("aria-expanded", "false");
      await expect(page.locator(".usage-meter-detail")).toHaveCount(0);

      await button.click();
      await expect(button).toHaveAttribute("aria-expanded", "true");
      await expect(detailRow(page, fr.billing.quotas.matchScores)).toHaveText("1 sur 1");
      await expect(detailRow(page, fr.billing.quotas.atsScores)).toHaveText("0 sur 1");
      await expect(detailRow(page, fr.billing.quotas.jobSearches)).toHaveText("0 sur 1");
      await expect(detailRow(page, fr.billing.quotas.enrichedContacts)).toHaveText(fr.billing.page.notIncluded);
      await expect(detailRow(page, fr.billing.quotas.jobDigest)).toHaveText(fr.billing.jobDigest.none);
      await expect(page.getByText(fr.billing.quotaReached.renews)).toBeVisible();

      await page.getByRole("link", { name: fr.usageMeter.subscription }).click();
      await expect(page).toHaveURL(`${origin}/abonnement`);
    });
  });
}
