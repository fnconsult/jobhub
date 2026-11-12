import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { startOwnServer, type OwnServer } from "./support/own-server";

// ADR-0105: the Human Coaches' path on the public site, behind HUMAN_COACH_PAGE_ENABLED (off by default; e2e/landing.spec.ts
// checks the 404 and the missing choice). Switched on for this spec's own server: the landing page then opens with
// « Candidat | Coach humain », each audience at its own address, and the coach's page leads to the Coach Enrolment form.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const en = JSON.parse(readFileSync("packages/shared/src/i18n/locales/en.json", "utf8"));
const coach = fr.landing.coachPath;
const PORT_OFFSET = 812;

test.describe("the Human Coaches' path, switched on (ADR-0105)", () => {
  test.describe.configure({ mode: "serial" });
  let server: OwnServer;

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    server = await startOwnServer(PORT_OFFSET, "landing_coach", {
      JOBHUB_TARGET: "e2e",
      JOBHUB_IGNORE_ROOT_ENV: "1",
      AUTH_SECRET: "e2e-landing-coach-e2e-landing-coach-e2e",
      MAIL_TRANSPORT: "console",
      HUMAN_COACH_PAGE_ENABLED: "true",
    });
  });

  test.afterAll(async () => {
    await server?.stop();
  });

  test("the landing page opens with the two audiences and shows the two doors", async ({ page }) => {
    await page.goto(`${server.origin}/`);
    const choice = page.getByRole("navigation", { name: coach.audience.label });
    await expect(choice.getByRole("link")).toHaveText([coach.audience.candidate, coach.audience.coach]);
    await expect(choice.getByRole("link", { name: coach.audience.candidate })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("main").getByRole("link", { name: new RegExp(coach.doors.coach.title) })).toHaveAttribute("href", "/coachs-humains");
    await choice.getByRole("link", { name: coach.audience.coach }).click();
    await expect(page).toHaveURL(`${server.origin}/coachs-humains`);
  });

  test("the coach's page says what Jobbbox is for a coach and leads to the enrolment form", async ({ page }) => {
    await page.goto(`${server.origin}/coachs-humains`);
    await expect(page).toHaveTitle(coach.meta.title);
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 1 })).toHaveText(coach.hero.title);
    const actions = main.getByRole("link", { name: coach.cta });
    await expect(actions).toHaveCount(2);
    for (const action of await actions.all()) await expect(action).toHaveAttribute("href", "/devenir-coach");
    await expect(page.getByRole("navigation", { name: coach.audience.label }).getByRole("link", { name: coach.audience.coach })).toHaveAttribute("aria-current", "page");
    const steps = main.getByRole("listitem").filter({ has: page.getByRole("heading", { level: 3 }) });
    await expect(steps.getByRole("heading", { level: 3 })).toHaveText(["request", "profile", "sessions", "earnings"].map((step) => coach.method.steps[step].title));
    // Nothing is promised that is not set: no amount, no rate.
    await expect(main).not.toContainText(/\d+\s?[€%]/);
    await expect(main.getByRole("link", { name: new RegExp(coach.doors.candidate.title) })).toHaveAttribute("href", "/");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
  });

  test("it is in English at /en, its way back to the candidate's path staying in English", async ({ page }) => {
    await page.goto(`${server.origin}/en/coachs-humains`);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toHaveText(en.landing.coachPath.hero.title);
    await expect(page.getByRole("main").getByRole("link", { name: en.landing.coachPath.cta }).first()).toHaveAttribute("href", "/devenir-coach");
    await expect(page.getByRole("navigation", { name: en.landing.coachPath.audience.label }).getByRole("link", { name: en.landing.coachPath.audience.candidate })).toHaveAttribute("href", "/en");
  });
});
