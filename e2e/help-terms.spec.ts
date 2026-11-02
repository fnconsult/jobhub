import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #343 (ADR-0035, « In pages, no chrome »): the first mention of a glossary term on a page is a button that opens
// its Help Article in the Coach Panel, and each empty state links to its article. Driven in the browser, in French.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
const titleOf = (id: string) => /^title: (.+)$/m.exec(readFileSync(`packages/help/articles/fr/${id}.md`, "utf8"))![1]!;
const SUFFIX = fr.helpTerms.suffix;
/** A HelpTerm's accessible name: the term as its sentence words it (whatever the case), then « (aide) ». */
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const termNamed = (term: string) => new RegExp(`^${escaped(`${term} ${SUFFIX}`)}$`, "i");

const panelOf = (page: Page) => page.getByRole("region", { name: fr.conversationFirst.label });
const cardOf = (page: Page, title: string) => panelOf(page).getByRole("article", { name: title });
const termButton = (page: Page, term: string) => page.locator("main").getByRole("button", { name: termNamed(term) });

const masterCv = {
  fullName: "Catherine Morel",
  headline: "Directrice administrative et financière",
  email: "catherine.morel@example.fr",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [{ title: "Directrice financière", employer: "Groupe Sorelis", location: "Lyon", period: "2000 – 2026", description: "Consolidation IFRS." }],
  education: [],
  skills: ["IFRS", "Consolidation", "Trésorerie"],
  languages: [],
};

/** A Profile for the signed-in Candidate; its id. */
async function createProfile(page: Page): Promise<string> {
  const profile = await page.request.post("/api/profiles", {
    data: { masterCv, searchCriteria: { targetRole: "DAF", locations: ["Lyon"], contractTypes: ["cdi"] } },
    headers: { origin },
  });
  expect(profile.status(), await profile.text()).toBe(201);
  return (await profile.json()).id;
}

/** An Application on a Job Offer of its own, at `status`; its id and its Job Offer's. */
async function createApplication(page: Page, profileId: string, status = "to_apply"): Promise<{ id: string; jobOfferId: string }> {
  const ref = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const captured = await page.request.post("/api/job-offers", {
    data: {
      source: { url: `https://www.apec.fr/offres/help-terms-${ref}` },
      title: "Directeur administratif et financier (H/F)",
      content: `Groupe Ferlac recrute son DAF (réf. ${ref}). Vous pilotez la consolidation IFRS.`,
      employer: "Groupe Ferlac",
      location: "Lyon",
      contractType: "cdi",
      skills: ["IFRS", "Consolidation"],
    },
    headers: { origin },
  });
  expect(captured.status(), await captured.text()).toBe(200);
  const jobOfferId = (await captured.json()).id as string;
  const saved = await page.request.post("/api/applications", { data: { jobOfferId, profileId }, headers: { origin } });
  expect(saved.ok(), await saved.text()).toBe(true);
  const id = (await saved.json()).id as string;
  if (status !== "to_apply") {
    const changed = await page.request.patch(`/api/applications/${id}`, { data: { status }, headers: { origin } });
    expect(changed.ok(), await changed.text()).toBe(true);
  }
  return { id, jobOfferId };
}

/** Clicks the HelpTerm `term` on the page shown, and expects the panel to show `article`'s card; then closes the panel. */
async function opensItsArticle(page: Page, term: string, article: string) {
  await termButton(page, term).click();
  const card = cardOf(page, titleOf(article));
  await expect(card).toBeVisible();
  await expect(card).toContainText(fr.coachPanel.help.cardLabel);
  await expect(card.getByRole("heading", { name: titleOf(article) })).toBeFocused();
  await panelOf(page).getByRole("button", { name: fr.coachPanel.close }).click();
  await expect(panelOf(page)).toHaveCount(0);
}

for (const viewport of [
  { name: "docked", width: 1440, height: 900 },
  { name: "phone", width: 375, height: 812 },
]) {
  test.describe(`glossary terms open their Help Article in the Coach Panel (${viewport.name}, #343)`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("each listed term opens its article in the panel", async ({ page }) => {
      await signInWithMagicLink(page, newAddress(`help-terms-${viewport.name}`));
      const profileId = await createProfile(page);
      const application = await createApplication(page, profileId);

      // Match Score: the Application's Correspondance Section and the Job Offer page.
      await page.goto(`/candidatures/${application.id}/correspondance`);
      await opensItsArticle(page, fr.matchScore.title, "glossary-match-score");
      await page.goto(`/offres/${application.jobOfferId}`);
      await opensItsArticle(page, fr.matchScore.title, "glossary-match-score");

      // ATS Score and CV de référence: the Profile's page.
      await page.goto(`/profils/${profileId}/ats-score`);
      await opensItsArticle(page, fr.atsScore.title, "glossary-ats-score");
      await page.goto(`/profils/${profileId}/cv-de-reference`);
      await opensItsArticle(page, fr.helpTerms.words.masterCv, "glossary-master-cv");

      // CV adapté: the Application's Documents, before any is proposed.
      await page.goto(`/candidatures/${application.id}/documents`);
      await opensItsArticle(page, fr.helpTerms.words.tailoredCv, "glossary-tailored-cv");

      // Relance: the Account's Relances.
      await page.goto("/compte/relances");
      await opensItsArticle(page, fr.helpTerms.words.followUp, "glossary-follow-up");

      // Plan Quota: the Usage Meter's detail, in the sidebar (its drawer on a phone).
      await page.goto("/candidatures");
      if (viewport.width < 1024) await page.getByRole("button", { name: fr.sidebar.menu, exact: true }).click();
      await page.getByRole("button", { name: new RegExp(`^${fr.usageMeter.title}`) }).click();
      await page.getByRole("button", { name: termNamed(fr.helpTerms.words.planQuota) }).click();
      await expect(cardOf(page, titleOf("glossary-plan-quota"))).toBeVisible();
      if (viewport.width < 768) {
        // On a phone the panel takes the whole screen.
        const box = (await panelOf(page).boundingBox())!;
        expect(box.width).toBe(viewport.width);
      }
    });
  });
}

test.describe("HelpTerms and empty states (#343)", () => {
  test("Propositions: the Action Cards' introduction opens its article", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("help-terms-propositions"));
    const profileId = await createProfile(page);
    await page.goto(`/profils/${profileId}/ats-score`);
    await page.getByRole("region", { name: fr.atsScore.title }).getByRole("button", { name: fr.atsScore.compute }).click();
    await expect(page).toHaveURL(`${origin}/profils/${profileId}/propositions`);
    await opensItsArticle(page, fr.helpTerms.words.proposals, "glossary-proposals");
  });

  test("a term mentioned twice on a page is a button only the first time", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("help-terms-twice"));
    const profileId = await createProfile(page);
    // The ATS Score Section names the CV de référence in its introduction, then again before the score is computed.
    await page.goto(`/profils/${profileId}/ats-score`);
    const section = page.getByRole("region", { name: fr.atsScore.title });
    await expect(section).toContainText(fr.atsScore.notYet);
    const mentions = section.getByText(/CV de référence/);
    await expect(mentions).toHaveCount(2);
    await expect(section.getByRole("button", { name: termNamed(fr.helpTerms.words.masterCv) })).toHaveCount(1);
    // The button is in the first mention, the introduction; the second is plain text.
    const intro = section.locator("p").filter({ hasText: "logiciels de recrutement" });
    await expect(intro.getByRole("button", { name: termNamed(fr.helpTerms.words.masterCv) })).toHaveCount(1);
    await expect(section.locator("p").filter({ hasText: fr.atsScore.notYet }).getByRole("button")).toHaveCount(0);

    // Another page starts afresh: its own first mention is a button.
    await page.goto(`/profils/${profileId}/cv-de-reference`);
    await expect(termButton(page, fr.helpTerms.words.masterCv)).toHaveCount(1);
  });

  test("HelpTerms are keyboard reachable, have a visible focus, and contrast at least 4.5:1 for text and 3:1 for the underline", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("help-terms-keyboard"));
    const profileId = await createProfile(page);
    await page.goto(`/profils/${profileId}/ats-score`);
    const button = termButton(page, fr.atsScore.title);
    await expect(button).toBeVisible();

    // Reached with Tab, like any button.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    let reached = false;
    for (let press = 0; press < 100 && !reached; press++) {
      await page.keyboard.press("Tab");
      reached = await button.evaluate((element) => element === document.activeElement);
    }
    expect(reached).toBe(true);
    const outline = await button.evaluate((element) => {
      const style = getComputedStyle(element);
      return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
    });
    expect(outline.style).not.toBe("none");
    expect(outline.width).toBeGreaterThanOrEqual(2);
    await page.keyboard.press("Enter");
    await expect(cardOf(page, titleOf("glossary-ats-score"))).toBeVisible();
    await panelOf(page).getByRole("button", { name: fr.coachPanel.close }).click();

    const contrast = await button.evaluate((element) => {
      const parse = (value: string) => value.match(/[\d.]+/g)!.map(Number);
      const luminance = (rgb: number[]) => {
        const [r, g, b] = rgb.map((c) => {
          const s = c / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
      };
      const ratio = (a: string, b: string) => {
        const [l1, l2] = [luminance(parse(a)), luminance(parse(b))].sort((x, y) => y - x);
        return (l1! + 0.05) / (l2! + 0.05);
      };
      let background = "rgb(255, 255, 255)";
      for (let node: Element | null = element; node; node = node.parentElement) {
        const color = getComputedStyle(node).backgroundColor;
        const [, , , alpha = 1] = parse(color);
        if (alpha > 0) {
          background = color;
          break;
        }
      }
      const style = getComputedStyle(element);
      return { text: ratio(style.color, background), underline: ratio(style.textDecorationColor, background), line: style.textDecorationLine, dotted: style.textDecorationStyle };
    });
    expect(contrast.text).toBeGreaterThanOrEqual(4.5);
    expect(contrast.underline).toBeGreaterThanOrEqual(3);
    expect(contrast.line).toBe("underline");
    expect(contrast.dotted).toBe("dotted");

    const results = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => node.target.join(" ")) }))).toEqual([]);
  });

  test("each empty state keeps its one line and links to its article", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("help-terms-empty"));
    const links = fr.emptyStateHelp;
    const opens = async (link: string, article: string) => {
      await page.locator("main").getByRole("button", { name: link, exact: true }).click();
      await expect(cardOf(page, titleOf(article))).toBeVisible();
      await panelOf(page).getByRole("button", { name: fr.coachPanel.close }).click();
    };

    // No Profile, no Application, no Interview.
    await page.goto("/compte");
    await expect(page.getByText(fr.profiles.none)).toBeVisible();
    await opens(links.profiles, "page-new-profile");
    await page.goto("/candidatures");
    await expect(page.getByText(fr.applications.none)).toBeVisible();
    await opens(links.applications, "page-applications");
    await page.goto("/agenda");
    await expect(page.getByText(fr.agenda.none)).toBeVisible();
    await opens(links.agenda, "page-agenda");

    // No Job Search yet for a new Profile.
    const profileId = await createProfile(page);
    await page.goto(`/recherches?profil=${profileId}`);
    await expect(page.getByText(fr.jobSearchesPage.never)).toBeVisible();
    await opens(links.jobSearches, "glossary-job-search");

    // An Application waiting for news, with no Relance to do yet, and no Propositions.
    const application = await createApplication(page, profileId, "applied");
    await page.goto("/candidatures");
    await expect(page.getByText(fr.followUps.noneWaiting)).toBeVisible();
    await opens(links.followUps, "glossary-follow-up");
    await page.goto(`/candidatures/${application.id}/propositions`);
    await expect(page.getByText(fr.actionCards.none)).toBeVisible();
    await opens(links.proposals, "glossary-proposals");
  });
});
