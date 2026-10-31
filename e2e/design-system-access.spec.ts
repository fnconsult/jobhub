import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #463 acceptance criteria, through the public entry points: the page over HTTP/UI for every Back Office Role and
// for a Candidate; CI's workflow and the how-to note as the repository ships them.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const admin = fr.admin;
const PAGE = "/admin/design-system";
const SUPER_ADMIN = "design-system-access-office@e2e.jobbbox.test";
const origin = process.env.E2E_WEB_ORIGIN!;
const ROLES = ["super-admin", "plans-manager", "coach-manager", "playbook-editor", "help-editor", "platform-manager", "support"];
const read = (file: string) => readFileSync(file, "utf8");

async function personPage(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: origin, locale: "en-US" });
  const page = await context.newPage();
  await signInWithMagicLink(page, email);
  return page;
}

async function grant(superAdmin: Page, email: string, role: string) {
  await superAdmin.goto("/admin/administrateurs");
  await superAdmin.getByLabel(admin.administrators.grantEmail).fill(email);
  await superAdmin.getByRole("checkbox", { name: admin.roles[role] }).check();
  await superAdmin.getByRole("button", { name: admin.administrators.grant }).click();
  await expect(superAdmin.getByRole("status")).toContainText(admin.roles[role]);
}

test.describe("Design System page access (#463)", () => {
  test("every Back Office Role reads it and a Candidate gets a 404", async ({ page, browser }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    for (const role of ROLES) {
      const email = role === "super-admin" ? SUPER_ADMIN : newAddress(`design-system-access-${role}`);
      const person = role === "super-admin" ? page : await personPage(browser, email);
      if (role !== "super-admin") await grant(page, email, role);
      const response = await person.goto(PAGE);
      expect(response?.status(), role).toBe(200);
      await expect(person.getByRole("heading", { level: 1 }), role).toHaveText(admin.sections.designSystem, { timeout: 20_000 });
    }

    const candidate = await personPage(browser, newAddress("design-system-access-candidate"));
    expect((await candidate.goto(PAGE))?.status()).toBe(404);
    await expect(candidate.getByRole("heading", { level: 1 })).toHaveText(fr.errorPage.notFound.title);
  });

  test("an anonymous visitor does not read it", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: origin });
    const page = await context.newPage();
    const response = await page.goto(PAGE);
    expect(response?.status() === 404 || /connexion|sign-?in|login/i.test(page.url())).toBe(true);
    await context.close();
  });

  test("CI runs the screenshot specs and fails on a visual difference", () => {
    const ci = read(".github/workflows/ci.yml");
    const job = ci.slice(ci.indexOf("\n  screenshots:"), ci.indexOf("\n  images:"));
    expect(job).toContain('E2E_SCREENSHOTS: "1"');
    expect(job).toContain("grep -l toHaveScreenshot e2e/*.spec.ts");
    // The emails' -linux baselines are compared in that image only (e2e/support/screenshots.ts).
    expect(job).toMatch(/--project=web --project=emails/);
    expect(job).not.toMatch(/continue-on-error/);
    expect(job).toContain("mcr.microsoft.com/playwright:v1.63.0-noble");
    const config = read("playwright.config.ts");
    expect(config).toMatch(/toHaveScreenshot/);
    expect(config).toMatch(/maxDiffPixelRatio/);
    expect(read("e2e/design-system-page.spec.ts")).toContain("toHaveScreenshot");
  });

  test("a note in docs/agents says how to update a baseline on purpose", () => {
    const note = read("docs/agents/screenshot-baselines.md");
    expect(note).toMatch(/Update a baseline on purpose/);
    expect(note).toContain("scripts/update-screenshot-baselines.sh");
    expect(read("scripts/update-screenshot-baselines.sh").length).toBeGreaterThan(0);
  });
});
