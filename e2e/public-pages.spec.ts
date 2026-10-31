import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { fromNewAddress, requestSignInLink } from "./support/candidate";
import { linkIn, newAddress, waitForEmail } from "./support/mailbox";

// Issue #470: the public pages in the Design System. The sign-in pages on their stage, their states as Notes; Légal,
// its side columns in view to the end of a long text; Nouveautés, the Release Notes this build carries.
// Issue #546: Légal's Legal Texts, their dated versions and version history, and the addresses that moved.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const en = JSON.parse(readFileSync("packages/shared/src/i18n/locales/en.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
const continueWithGoogle = fr.signIn.continueWith.replace("{{provider}}", "Google");

/** The Note holding `text`: a Design System Note, of `tone`. */
const note = (page: Page, text: string) => page.locator(".ds-note").filter({ hasText: text });

async function axeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
}

test.describe("sign-in on the public pages' stage", () => {
  test("a Candidate still signs in by email link: the providers, « ou », the email field, then the sent Note", async ({ page }) => {
    const email = newAddress("public.sign-in");
    await fromNewAddress(page);
    await page.goto("/connexion");
    const card = page.locator(".ds-sign-in__card");
    // The providers' buttons first, « ou », then the email field and its button (prototype #connexion).
    await expect(card.getByRole("button")).toHaveText([continueWithGoogle, fr.signIn.submit]);
    await expect(card.getByText(fr.signIn.or, { exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: fr.publicSite.nav })).toBeVisible();
    await expect(page.getByRole("link", { name: fr.nav.signIn })).toHaveCount(0);
    expect(await axeViolations(page)).toEqual([]);

    await requestSignInLink(page, email);
    await expect(page.getByRole("status")).toHaveText(fr.signIn.sent);
    await expect(note(page, fr.signIn.sent)).toHaveAttribute("data-tone", "success");

    await page.goto(linkIn(await waitForEmail(email)));
    await expect(page).toHaveURL(`${origin}/compte`);
  });

  test("each failed sign-in shows its Note: a dead link as a warning, a failure as a danger", async ({ page }) => {
    const states = [
      { error: "EXPIRED_TOKEN", text: fr.signIn.linkError, tone: "warn" },
      { error: "INVALID_TOKEN", text: fr.signIn.linkError, tone: "warn" },
      { error: "access_denied", text: fr.signIn.failed.replace("{{providers}}", "Google"), tone: "danger" },
      { error: "account_not_linked", text: fr.signIn.accountNotLinked, tone: "danger" },
      { error: "provider_not_allowed", text: fr.signIn.providerNotAllowed, tone: "danger" },
      { error: "provider_disabled", text: fr.signIn.providerDisabled, tone: "danger" },
    ];
    for (const { error, text, tone } of states) {
      await page.goto(`/connexion?error=${error}`);
      const alert = page.getByRole("main").getByRole("alert");
      await expect(alert, error).toHaveText(text);
      await expect(alert, error).toHaveAttribute("data-tone", tone);
      // The form stays under it, to try again.
      await expect(page.getByLabel(fr.signIn.emailLabel)).toBeVisible();
    }
    await page.goto("/connexion/back-office?error=EXPIRED_TOKEN");
    await expect(page.getByRole("main").getByRole("alert")).toHaveAttribute("data-tone", "warn");
  });

  test("the legal line leads to the Légal page's terms of use and privacy policy", async ({ page }) => {
    await page.goto("/connexion");
    const legal = page.locator(".ds-sign-in__legal");
    await expect(legal).toHaveText(`${fr.signIn.legalLine.before} ${fr.signIn.legalLine.terms} ${fr.signIn.legalLine.between} ${fr.signIn.legalLine.privacy}${fr.signIn.legalLine.after}`);
    await legal.getByRole("link", { name: fr.signIn.legalLine.privacy }).click();
    await expect(page).toHaveURL(`${origin}/legal/confidentialite`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.legal.texts.confidentialite);
  });
});

test.describe("Légal", () => {
  test("its navigation and table of contents stay visible to the end of a long page, the contents following the reading", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/design-system/legal");
    const documents = page.getByRole("navigation", { name: fr.legal.documentsNav });
    const toc = page.getByRole("navigation", { name: fr.legal.toc });
    const header = page.locator(".ds-site__head");
    const tocLinks = toc.getByRole("link");
    await expect(tocLinks).toHaveCount(12);
    await expect(tocLinks.first()).toHaveAttribute("aria-current", "location");

    // Both columns under the site's header and inside the window, once the page has settled where it was scrolled to.
    const inView = () =>
      expect(async () => {
        const head = (await header.boundingBox())!;
        for (const column of [documents, toc]) {
          const box = (await column.boundingBox())!;
          expect(box.y, "under the site's header").toBeGreaterThanOrEqual(head.y + head.height - 1);
          expect(box.y + box.height, "inside the window").toBeLessThanOrEqual(720);
        }
      }).toPass({ timeout: 5_000 });
    await inView();
    // Halfway through the text, then at its very end: both columns still in view.
    await page.evaluate(() => window.scrollTo({ top: document.getElementById("section-6")!.getBoundingClientRect().top + window.scrollY - 100, behavior: "instant" }));
    await expect(toc.locator('[aria-current="location"]')).toHaveText("Section de démonstration 6");
    await inView();
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
    await expect(page.getByRole("link", { name: fr.legal.pdf })).toBeInViewport();
    await expect(toc.locator('[aria-current="location"]')).toHaveText("Section de démonstration 12");
    await inView();

    // A link of « Sur cette page » leads to its section, under the header.
    await tocLinks.nth(2).click();
    await expect(page).toHaveURL(/#section-3$/);
    await expect(page.locator("#section-3")).toBeInViewport();
    expect(await axeViolations(page)).toEqual([]);
  });

  test("a text the team has not written yet shows that it is not published; Légal opens on its first text", async ({ page }) => {
    await page.goto("/legal");
    await expect(page).toHaveURL(`${origin}/legal/cgu`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.legal.texts.cgu);
    await expect(page.getByRole("heading", { name: fr.legal.notPublishedTitle })).toBeVisible();
    const documents = page.getByRole("navigation", { name: fr.legal.documentsNav });
    await expect(documents.getByRole("link")).toHaveText(Object.values(fr.legal.texts) as string[]);
    await expect(documents.getByRole("link", { name: fr.legal.texts.cgu })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("navigation", { name: fr.publicSite.nav }).getByRole("link", { name: fr.publicSite.legal })).toHaveAttribute("aria-current", "page");
    expect(await axeViolations(page)).toEqual([]);
    expect((await page.request.get("/api/legal/cgu/pdf")).status()).toBe(404);
    expect((await page.goto("/legal/blog"))?.status()).toBe(404);
  });

  test("the version history of a text not written yet shows that it is not published; a date that is no version is not found", async ({ page }) => {
    await page.goto("/legal/cgv/versions");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.legal.history);
    await expect(page.getByRole("heading", { name: fr.legal.notPublishedTitle })).toBeVisible();
    await expect(page.getByRole("navigation", { name: fr.legal.documentsNav }).getByRole("link", { name: fr.legal.texts.cgv })).toHaveAttribute("aria-current", "page");
    expect(await axeViolations(page)).toEqual([]);
    expect((await page.goto("/legal/cgu/2026-01-01"))?.status()).toBe(404);
    expect((await page.goto("/legal/cgu/demain"))?.status()).toBe(404);
  });

  test("the addresses that moved redirect for good: « IA dans Jobbbox », #470's documents and ?version=", async ({ page }) => {
    const moves = [
      ["/legal/ia", "/legal/confidentialite#ia"],
      ["/legal/conditions-utilisation", "/legal/cgu"],
      ["/legal/cookies", "/legal/confidentialite#cookies"],
      ["/legal/sous-traitants-et-ia", "/legal/confidentialite#ia"],
      ["/legal/cgu?version=2026-12-01", "/legal/cgu/2026-12-01"],
      ["/legal/conditions-utilisation?version=2026-12-01&lang=en", "/legal/cgu/2026-12-01?lang=en"],
    ];
    for (const [from, to] of moves) {
      const response = await page.request.get(from, { maxRedirects: 0 });
      expect(response.status(), from).toBe(308);
      expect(new URL(response.headers().location!, origin).href, from).toBe(`${origin}${to}`);
    }
    // In the browser, the redirected page opens at its section.
    await page.goto("/legal/ia");
    await expect(page).toHaveURL(`${origin}/legal/confidentialite#ia`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.legal.texts.confidentialite);
  });
});

test.describe("Nouveautés", () => {
  test("lists the Release Notes this build carries; with none yet, it shows that nothing is published, and has no email field", async ({ page }) => {
    await page.goto("/nouveautes");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.nouveautes.title);
    await expect(page.getByRole("navigation", { name: fr.publicSite.nav }).getByRole("link", { name: fr.publicSite.nouveautes })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: fr.nouveautes.emptyTitle })).toBeVisible();
    await expect(page.getByRole("textbox")).toHaveCount(0);
    await expect(page.getByRole("link", { name: fr.nav.signIn })).toHaveAttribute("href", "/connexion");
    expect(await axeViolations(page)).toEqual([]);
  });

  test("speaks the page's language", async ({ page }) => {
    await page.goto("/nouveautes?lang=en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(en.nouveautes.title);
    await expect(page.getByRole("heading", { name: en.nouveautes.emptyTitle })).toBeVisible();
  });
});
