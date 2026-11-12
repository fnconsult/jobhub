import { existsSync, readFileSync } from "node:fs";
import AxeBuilder from "../support/axe";
import { expect, test, type Page } from "@playwright/test";

// « Espace coach v2 » on (#867, ADR-0106): the Help Centre serves the Human Coach epic's articles, each `.v2` in its
// base's place. With it off (e2e/help-centre.spec.ts, e2e/help-centre-videos.spec.ts), the articles main served.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const en = JSON.parse(readFileSync("packages/shared/src/i18n/locales/en.json", "utf8"));
/** An article's title as « Espace coach v2 » serves it: its `.v2.md`'s when it has one, quotes around it dropped. */
const titleOf = (locale: "fr" | "en", id: string) => {
  const v2 = `packages/help/articles/${locale}/${id}.v2.md`;
  const file = existsSync(v2) ? v2 : `packages/help/articles/${locale}/${id}.md`;
  return /^title: (.+)$/m.exec(readFileSync(file, "utf8"))![1]!.replace(/^(["'])(.*)\1$/, "$2");
};

async function axeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
}

const main = (page: Page) => page.getByRole("main");

test.describe("« Espace coach » with « Espace coach v2 » on (#867)", () => {
  const COACH_SPACE = ["page-coach-space", "page-association-coachs", "page-association-invitation", "page-association-membres", "page-association-offres", "page-association-revenus", "page-association-space", "page-coach-availability", "page-coach-contract-version", "page-coach-contract", "page-coach-earnings", "page-coach-public-profile", "page-coach-reminders", "page-coach-session", "faq-coach-access", "faq-retired-human-coach", "faq-coach-two-step-verification", "faq-coach-app-two-step-verification", "faq-coach-app-notifications", "faq-coach-cancel-session", "faq-coach-contract", "faq-coach-reminders", "faq-coach-tax", "tutorial-association-add-coach", "tutorial-coach-availability", "tutorial-coach-get-paid", "tutorial-coach-meeting-contact", "tutorial-coach-present-slides", "tutorial-coach-review", "tutorial-coach-session-date", "tutorial-coach-session-report", "tutorial-coach-shared-reading", "tutorial-coach-tax", "tutorial-coaching-reminders", "tutorial-edit-coach-page", "glossary-association-member", "glossary-coach-page"];

  test("/aide/espace-coach and /en/aide/espace-coach list the current Coach and Association workspace articles", async ({ page }) => {
    for (const [locale, prefix] of [["fr", ""], ["en", "/en"]] as const) {
      await page.goto(`${prefix}/aide/espace-coach`);
      const list = main(page).getByRole("list", { name: (locale === "fr" ? fr : en).helpCentre.inTopic });
      await expect(list.getByRole("link")).toHaveCount(COACH_SPACE.length);
      for (const id of COACH_SPACE) await expect(list.getByRole("link", { name: titleOf(locale, id), exact: true })).toHaveAttribute("href", `${prefix}/aide/espace-coach/${id}`);
    }
  });

  test("the tutorial « Saisir la date et le lien d'une séance » is a numbered list of the new coach space's labels", async ({ page }) => {
    await page.goto("/aide/espace-coach/tutorial-coach-session-date");
    const steps = main(page).locator(".help-centre__body ol > li");
    await expect(steps).toHaveCount(3);
    await expect(steps.nth(0)).toContainText(`« ${fr.coachSpaceV2.pages.seances} »`);
    await expect(steps.nth(0)).toContainText(`« ${fr.coachingSession.coachEnterDate} »`);
    await expect(steps.nth(1)).toContainText(`« ${fr.coachingSession.date} »`);
    await expect(steps.nth(1)).toContainText(`« ${fr.coachingSession.save} »`);
    await expect(steps.nth(2)).toContainText(`« ${fr.coachMeeting.sessionContact} »`);
    expect(await axeViolations(page)).toEqual([]);
  });

  test("serves an article the epic added, which is a 404 while the setting is off", async ({ page }) => {
    const response = await page.goto("/aide/espace-coach/page-coach-earnings");
    expect(response!.status()).toBe(200);
    await expect(main(page).getByRole("heading", { level: 1 })).toHaveText(titleOf("fr", "page-coach-earnings"));
  });

  test("lets the Cal.com booking be framed: the Content-Security-Policy adds Cal.com to frame-src", async ({ page }) => {
    const response = await page.goto("/aide");
    expect(response!.headers()["content-security-policy"]).toMatch(/^media-src \S+; frame-src 'self' https:\/\/cal\.com https:\/\/app\.cal\.com$/);
  });
});
