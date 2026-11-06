import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { ficheOf } from "./support/conversation";
import { newAddress } from "./support/mailbox";
import { showInTheme, THEMES } from "./support/theme";

// One scroll model on a conversation's page (#601, ADR-0070; reported again on the Beta): the page is the screen and never
// scrolls as a whole; the conversation scrolls in its own column under the Top Bar, its box pinned at its foot, and the
// Work Pane and the Fiche beside it each scroll in themselves. A long message and a long reply stay readable from end to
// end, and a reply that arrives shows from its first line, never hidden under the Top Bar.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;

const masterCv = {
  fullName: "Catherine Morel",
  headline: "Head of BU",
  email: "catherine.morel@exemple.fr",
  phone: "06 12 34 56 78",
  location: "Lyon",
  summary: Array.from({ length: 12 }, (_, i) => `Ligne ${i + 1} du résumé, assez longue pour remplir la zone d'édition du CV de référence.`).join("\n"),
  experience: [{ title: "Head of BU", employer: "Groupe Sorelis", location: "Lyon", period: "2015 – 2026", description: "Une BU de 120 personnes." }],
  education: [],
  skills: ["Professional services"],
  languages: [],
};
const TITLE = "HEAD OF BU / PROFESSIONAL SERVICES";
/** A pasted block, many lines long; E2E_COACH_LONG has the AI Coach answer 30 paragraphs (e2e/support/fake-mistral.mjs). */
const LONG_MESSAGE = ["E2E_COACH_LONG Voici l'offre :", ...Array.from({ length: 24 }, (_, i) => `Ligne collée ${i + 1} de l'offre.`), "Fin de mon message."].join("\n");

const conversation = (page: Page) => page.getByRole("region", { name: fr.conversationFirst.label });
const box = (page: Page) => conversation(page).getByLabel(fr.coachPanel.messageLabel);

async function withProfile(page: Page): Promise<string> {
  await signInWithMagicLink(page, newAddress("conversation-scroll"));
  const created = await page.request.post("/api/profiles", { headers: { origin }, data: { masterCv, searchCriteria: { targetRole: TITLE, locations: ["Lyon"] } } });
  expect(created.status(), await created.text()).toBe(201);
  return (await created.json()).id;
}

async function withApplication(page: Page): Promise<string> {
  const profileId = await withProfile(page);
  const offer = await page.request.post("/api/job-offers", {
    headers: { origin },
    data: { source: { url: `https://www.apec.fr/offres/scroll-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }, title: TITLE, content: "Pilotage d'une BU.", employer: "Acme", location: "Lyon" },
  });
  expect(offer.status(), await offer.text()).toBe(200);
  const saved = await page.request.post("/api/applications", { headers: { origin }, data: { jobOfferId: (await offer.json()).id, profileId } });
  expect(saved.ok(), await saved.text()).toBe(true);
  return (await saved.json()).id;
}

/** Sends the long message and waits for the long reply. */
async function sendLongMessage(page: Page) {
  await box(page).fill(LONG_MESSAGE);
  await conversation(page).getByRole("button", { name: fr.coachPanel.send }).click();
  await expect(conversation(page).getByText("FIN DE LA RÉPONSE")).toHaveCount(1);
}

/** Where the conversation can be read: under the Top Bar, above its box. */
async function readable(page: Page): Promise<{ top: number; bottom: number }> {
  const top = (await page.getByRole("banner").boundingBox())!;
  const foot = (await conversation(page).locator(".page-conversation-foot").boundingBox())!;
  return { top: top.y + top.height, bottom: foot.y };
}

/**
 * `text`'s first line is whole where the conversation can be read: not under the Top Bar, not behind the box, not off
 * the screen.
 */
async function expectReadable(page: Page, text: Locator) {
  await expect(async () => {
    const shown = (await text.boundingBox())!;
    const line = await text.evaluate((element) => parseFloat(getComputedStyle(element).lineHeight) || 24);
    const { top, bottom } = await readable(page);
    expect(shown.y, "below the Top Bar").toBeGreaterThanOrEqual(top - 1);
    expect(shown.y + Math.min(line, shown.height), "above the box").toBeLessThanOrEqual(bottom + 1);
  }).toPass({ timeout: 5_000 });
}

/** The page is the screen: it never scrolls as a whole, and nothing is left below its columns. */
async function expectScreenTall(page: Page) {
  const size = await page.evaluate(() => ({ page: document.documentElement.scrollHeight, screen: window.innerHeight, scrolled: window.scrollY }));
  expect(size.page).toBe(size.screen);
  expect(size.scrolled).toBe(0);
  const workspace = (await page.locator(".workspace").boundingBox())!;
  expect(workspace.y + workspace.height).toBe(size.screen);
}

/** Scrolls the conversation's column by `by` pixels, the wheel over it. */
async function scrollThread(page: Page, by: number) {
  const where = (await box(page).boundingBox())!;
  await page.mouse.move(where.x + where.width / 2, where.y - 80);
  await page.mouse.wheel(0, by);
}

/** Whether `text`'s first line is where the conversation can be read. */
async function isReadable(page: Page, text: Locator): Promise<boolean> {
  const shown = await text.boundingBox();
  if (!shown) return false;
  const { top, bottom } = await readable(page);
  return shown.y >= top - 1 && shown.y + Math.min(24, shown.height) <= bottom + 1;
}

/** Scrolls the conversation's column, a wheel's notch at a time (`by`), until `text`'s first line can be read. */
async function scrollTo(page: Page, text: Locator, by: number) {
  for (let notch = 0; notch < 60 && !(await isReadable(page, text)); notch++) {
    await scrollThread(page, by);
    await page.waitForTimeout(30);
  }
  await expectReadable(page, text);
}

/** A whole long message and a whole long reply are reachable; the reply's first line shows as it arrives. */
async function expectWholeThread(page: Page) {
  await sendLongMessage(page);
  await expectReadable(page, conversation(page).getByText("Paragraphe 1 :", { exact: false }));
  await expectScreenTall(page);

  // Up to the start of the Candidate's message, then down to the reply's last line, its feedback and the box.
  await scrollTo(page, conversation(page).locator(".chat-candidate > p").filter({ hasText: "E2E_COACH_LONG Voici l'offre" }), -200);
  await scrollTo(page, conversation(page).getByText("FIN DE LA RÉPONSE"), 200);
  await scrollThread(page, 20_000);
  // The reply's last part (its Provenance line, « Cela répond à votre question ? »), above the box.
  await expectReadable(page, conversation(page).locator(".coach-panel-messages > li:last-child > :last-child"));
  await expect(box(page)).toBeInViewport({ ratio: 1 });
  await expectScreenTall(page);
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 2000, height: 1100 },
]) {
  test.describe(`at ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport });

    for (const theme of THEMES) {
      test(`a Profile's « CV de référence »: the thread scrolls in its column, the Work Pane and the Fiche in theirs (${theme})`, async ({ page }) => {
        const id = await withProfile(page);
        await page.goto(`/profils/${id}/cv-de-reference`);
        await showInTheme(page, theme);
        await expectWholeThread(page);

        // The Work Pane's top is never cut, and its foot ends above the screen's: it scrolls in itself.
        const top = (await page.getByRole("banner").boundingBox())!;
        const pane = (await page.getByRole("complementary", { name: fr.profile.masterCv }).boundingBox())!;
        expect(pane.y).toBeGreaterThan(top.y + top.height);
        expect(pane.y + pane.height).toBeLessThanOrEqual(viewport.height);
        if (viewport.width >= 2000) {
          const fiche = (await ficheOf(page).boundingBox())!;
          expect(fiche.y).toBeGreaterThan(top.y + top.height);
          expect(fiche.y + fiche.height).toBeLessThanOrEqual(viewport.height);
        }
        // Scrolling the thread leaves them where they are.
        await scrollThread(page, -20_000);
        expect((await page.getByRole("complementary", { name: fr.profile.masterCv }).boundingBox())!.y).toBe(pane.y);
      });
    }
  });
}

test("an Application's page: the long message and the long reply are reachable, the reply from its first line", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const id = await withApplication(page);
  await page.goto(`/candidatures/${id}`);
  await expectWholeThread(page);
});

test("on a phone the conversation takes the whole screen, its box pinned at its foot (ADR-0070)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const id = await withProfile(page);
  await page.goto(`/profils/${id}`);
  await expectWholeThread(page);
});
