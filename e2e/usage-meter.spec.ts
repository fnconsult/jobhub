import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// The sidebar's Usage Meter (ADR-0032): the week's Plan Quotas as one bar, each weighed by
// what the Plan grants; its button shows each quota's use, and leads to the subscription page.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const en = JSON.parse(readFileSync("packages/shared/src/i18n/locales/en.json", "utf8"));
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

      await page.getByRole("link", { name: fr.usageMeter.subscription }).click();
      await expect(page).toHaveURL(`${origin}/abonnement`);
    });

    test("is titled « Hebdomadaire », says on one line under its bar when the quotas renew, and opens its detail upward (#321)", async ({ page }) => {
      await signInWithMagicLink(page, newAddress(`usage-meter-321-${viewport.name}`));
      await page.goto("/candidatures");
      if (viewport.width < 1024) await page.getByRole("button", { name: fr.sidebar.menu, exact: true }).click();

      const button = meterButton(page);
      await expect(button.locator(".usage-meter-head > :first-child")).toHaveText("Hebdomadaire");
      await expectRenewalOnOneLineUnderTheBar(page, "Votre quota se renouvelle lundi minuit");

      // Opened, the detail is a smaller card above the meter: nothing in the sidebar's foot moves.
      const account = page.getByRole("link", { name: fr.nav.account, exact: true }).locator("visible=true");
      const accountBefore = (await account.boundingBox())!;
      const buttonBefore = (await button.boundingBox())!;
      await button.click();
      await expect(button).toHaveAttribute("aria-expanded", "true");
      const controls = (await button.getAttribute("aria-controls"))!;
      const detail = page.locator(`[id="${controls}"]`);
      await expect(detail).toBeVisible();
      await expect(detail).toHaveClass(/usage-meter-detail/);
      // (Vertically: on a phone the drawer may still be sliding in.)
      expect((await account.boundingBox())!.y).toBe(accountBefore.y);
      expect((await button.boundingBox())!.y).toBe(buttonBefore.y);
      const card = (await detail.boundingBox())!;
      expect(card.y + card.height).toBeLessThanOrEqual(buttonBefore.y);
      const look = await detail.evaluate((el) => {
        const style = getComputedStyle(el);
        return { position: style.position, border: parseFloat(style.borderTopWidth), shadow: style.boxShadow, fontSize: parseFloat(style.fontSize), body: parseFloat(getComputedStyle(document.body).fontSize) };
      });
      expect(look.position).toBe("absolute");
      expect(look.border).toBeGreaterThan(0);
      expect(look.shadow).not.toBe("none");
      expect(look.fontSize).toBeLessThan(look.body);

      // The renewal sentence is said once, under the bar, not again in the detail.
      await expect(detail).not.toContainText(fr.usageMeter.renews);
      await expect(detail).not.toContainText(fr.billing.quotaReached.renews);
      await expect(page.locator(".usage-meter-renews").locator("visible=true")).toHaveCount(1);

      // Escape closes the card, the focus back on the button, the sidebar (a drawer on a phone) still open.
      await page.keyboard.press("Escape");
      await expect(button).toHaveAttribute("aria-expanded", "false");
      await expect(page.locator(".usage-meter-detail")).toHaveCount(0);
      await expect(button).toBeFocused();
      await expect(button).toBeVisible();

      // From the card's own link too.
      await page.keyboard.press("Enter");
      await expect(button).toHaveAttribute("aria-expanded", "true");
      await page.getByRole("link", { name: fr.usageMeter.subscription }).focus();
      await page.keyboard.press("Escape");
      await expect(button).toHaveAttribute("aria-expanded", "false");
      await expect(button).toBeFocused();
      await expect(button).toBeVisible();
    });

    test("in English, is titled « Weekly » and keeps its longer renewal sentence on one line (#321)", async ({ page }) => {
      await signInWithMagicLink(page, newAddress(`usage-meter-321-en-${viewport.name}`));
      const switched = await page.request.post("/api/auth/update-user", { data: { interfaceLanguage: "en" }, headers: { origin } });
      expect(switched.ok(), await switched.text()).toBe(true);
      await page.goto("/candidatures");
      if (viewport.width < 1024) await page.getByRole("button", { name: en.sidebar.menu, exact: true }).click();

      const button = page.getByRole("button", { name: new RegExp(`^${en.usageMeter.title}`) });
      await expect(button.locator(".usage-meter-head > :first-child")).toHaveText("Weekly");
      await expectRenewalOnOneLineUnderTheBar(page, "Your quota renews Monday at midnight");
    });
  });
}

/** The renewal sentence: under the bar, smaller than the title, on one line, cut with an ellipsis rather than wrapped. */
async function expectRenewalOnOneLineUnderTheBar(page: Page, sentence: string) {
  const renews = page.locator(".usage-meter-renews").locator("visible=true");
  await expect(renews).toHaveText(sentence);
  const bar = (await page.getByRole("progressbar").locator("visible=true").boundingBox())!;
  const box = (await renews.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(bar.y + bar.height);
  const style = await renews.evaluate((el) => {
    const own = getComputedStyle(el);
    const title = getComputedStyle(el.closest(".usage-meter")!.querySelector(".usage-meter-head > :first-child")!);
    return {
      whiteSpace: own.whiteSpace,
      overflow: own.overflowX,
      textOverflow: own.textOverflow,
      fontSize: parseFloat(own.fontSize),
      lineHeight: parseFloat(own.lineHeight) || parseFloat(own.fontSize) * 1.6,
      titleSize: parseFloat(title.fontSize),
    };
  });
  expect(style).toMatchObject({ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" });
  expect(style.fontSize).toBeLessThan(style.titleSize);
  // One line: no taller than a line of its own type.
  expect(box.height).toBeLessThanOrEqual(Math.ceil(style.lineHeight) + 1);
}

test("the Usage Meter's i18n keys are identical in French and English (#321)", () => {
  expect(Object.keys(fr.usageMeter).sort()).toEqual(Object.keys(en.usageMeter).sort());
  for (const key of Object.keys(fr.usageMeter)) expect(typeof fr.usageMeter[key], key).toBe(typeof en.usageMeter[key]);
  expect(fr.usageMeter.title).toBe("Hebdomadaire");
  expect(en.usageMeter.title).toBe("Weekly");
});

test("a renewal sentence wider than its room is cut with an ellipsis, not wrapped (#321)", async ({ page }) => {
  await signInWithMagicLink(page, newAddress("usage-meter-321-cut"));
  await page.goto("/candidatures");
  const renews = page.locator(".usage-meter-renews").locator("visible=true");
  await expect(renews).toBeVisible();
  // Squeeze the room the sentence has; it must stay on one line and overflow into its ellipsis.
  await renews.evaluate((el) => { (el as HTMLElement).style.width = "60px"; (el as HTMLElement).style.display = "block"; });
  const cut = await renews.evaluate((el) => ({ overflowing: el.scrollWidth > el.clientWidth, height: el.getBoundingClientRect().height, line: parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.6 }));
  expect(cut.overflowing).toBe(true);
  expect(cut.height).toBeLessThanOrEqual(Math.ceil(cut.line) + 1);
});
