import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { activityButtonOf, activityOf } from "./support/conversation";
import { newAddress } from "./support/mailbox";
import { subscribe } from "./support/plan";

// Issue #1051 (decision #1043): the first welcome on /profils/nouveau, for a Candidate without any finished Profile. On a
// wide screen, the page opens split in two from the first question, the conversation on the left and Activité on the
// right, resized by the side panel's handle (#1040), never empty: the Profile in construction, then the offered Job
// Search's progress and its Job Offers with their Match Score. On a phone, no split: a card of the first offers in the
// thread, once some reach the Match Score threshold. « Ajouter un profil » (a finished Profile exists) is unchanged.
// The AI is said down (E2E_AI_DOWN), so the scripted questions ask the same every run; no worker runs here, so the
// search is simulated as its worker reports it (`job_search.live`).
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const WIDE = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const welcome = fr.newProfile.firstWelcome;

test.use({ baseURL: origin });

async function query<T = Record<string, unknown>>(sql: string, values: unknown[] = []): Promise<T[]> {
  const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await db.connect();
  try {
    return (await db.query(sql, values)).rows as T[];
  } finally {
    await db.end();
  }
}

/** The thread of the « Entretien d'accueil ». */
const threadOf = (page: Page) => page.getByRole("list", { name: fr.questionnaire.transcript });
/** The Profile in construction, at the top of Activité in the split. */
const buildingOf = (page: Page) => activityOf(page).getByRole("region", { name: welcome.building.label });
const buildingValue = (page: Page, term: string) => buildingOf(page).locator(".ds-prop", { has: page.getByRole("term").filter({ hasText: term }) }).getByRole("definition");

/** Sends what the box holds: the opening line, then each answer. */
async function say(page: Page, label: string, text: string) {
  await page.getByLabel(label).fill(text);
  await page.getByRole("button", { name: fr.coachPanel.send, exact: true }).click();
}

/** The questions without a CV, the AI down: its scripted questions, from the target role. */
async function startWithoutCv(page: Page) {
  await say(page, fr.coachPanel.messageLabel, "Je n'ai pas de CV à jour E2E_AI_DOWN");
  await expect(page.getByText(fr.newProfile.interview.fallback)).toBeVisible();
}

/** The offered Job Search the Profile born started, once it is there. */
async function offeredSearchOf(email: string): Promise<string> {
  let id: string | null = null;
  await expect
    .poll(async () => {
      const [row] = await query<{ id: string }>("SELECT s.id FROM job_search s JOIN candidate c ON c.id = s.candidate_id WHERE c.email = $1 AND s.offered = 'first'", [email]);
      id = row?.id ?? null;
      return id;
    })
    .not.toBeNull();
  return id!;
}

/**
 * Job Offers for « Directrice financière » in `place`, as the search found them, asking for no skill nor experience: in
 * Lyon, the place answered, their Match Score reaches the threshold; elsewhere it does not.
 */
async function insertJobOffers(batch: string, place = "Lyon"): Promise<string[]> {
  const offers = [
    { title: "Directrice financière", employer: "Groupe Ferlac", site: "apec.fr" },
    { title: "Directrice financière groupe", employer: "Valrhône Industrie", site: "welcometothejungle.com" },
    { title: "Directrice financière adjointe", employer: "Lumen Santé", site: "francetravail.fr" },
    { title: "Directrice financière Rhône", employer: "Atelier Saône", site: "apec.fr" },
  ];
  const ids: string[] = [];
  for (const [index, offer] of offers.entries()) {
    const key = `${tag}-${batch}-${index}`;
    const [row] = await query<{ id: string }>(
      `INSERT INTO job_offer (url_key, content_fingerprint, source_url, source_name, title, content, employer, location, contract_type, remote_work,
         salary_min, salary_max, skills, required_experience_years, posted_at, text_read_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'cdi', 'hybrid', 90000, 110000, '{}', NULL, now(), now()) RETURNING id`,
      [
        `${offer.site}/offres/${key}`,
        `first-welcome-${key}`,
        `https://www.${offer.site}/offres/${key}`,
        offer.site,
        offer.title,
        `${offer.employer} recrute sa directrice financière à ${place}.`,
        offer.employer,
        place,
      ],
    );
    ids.push(row!.id);
  }
  return ids;
}

/** The run's measures, written on the Job Search as its worker writes them while it searches. */
async function measured(jobSearchId: string, jobOfferIds: string[]) {
  const live = {
    step: "analysis",
    sources: [
      { source: "france_travail", state: "searched" },
      { source: "web_search", state: "searching" },
    ],
    pagesRead: 8,
    offersAnalysed: jobOfferIds.length,
    matched: null,
    jobOfferIds,
  };
  await query("UPDATE job_search SET live = $2::jsonb WHERE id = $1", [jobSearchId, JSON.stringify(live)]);
}

test.describe("the first welcome on a wide screen: split in two (#1051)", () => {
  test.use({ viewport: WIDE });

  test("Activité beside the conversation from the first question: the Profile in construction, then the offered search and its offers", async ({ page }) => {
    test.setTimeout(120_000);
    const email = newAddress("first-welcome-wide");
    await signInWithMagicLink(page, email);
    await page.goto("/profils/nouveau");

    // Split from the start: the conversation on the left, Activité on the right.
    await expect(activityButtonOf(page)).toHaveAttribute("aria-expanded", "true");
    const activity = activityOf(page);
    await expect(activity).toHaveClass(/first-welcome-split/);
    const conversation = page.getByRole("region", { name: fr.newProfile.conversation });
    const [left, right] = await Promise.all([conversation.boundingBox(), activity.boundingBox()]);
    expect(left!.x + left!.width).toBeLessThanOrEqual(right!.x);
    // About half each.
    expect(right!.width).toBeGreaterThan(450);

    // The side panel's handle (#1040): focusable, by the keyboard, never under its narrowest.
    const handle = activity.getByRole("separator", { name: fr.fiche.resize });
    const before = Number(await handle.getAttribute("aria-valuenow"));
    await handle.focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => Number(await handle.getAttribute("aria-valuenow"))).toBeLessThan(before);
    await page.keyboard.press("Home");
    await expect(handle).toHaveAttribute("aria-valuenow", await handle.getAttribute("aria-valuemin") ?? "");
    await page.keyboard.press("End");

    // Never empty before the Profile: the Profile in construction, filled as the Candidate answers.
    await expect(buildingValue(page, welcome.building.targetRole)).toHaveText(welcome.building.missing);
    await startWithoutCv(page);
    await expect(buildingValue(page, welcome.building.cv)).toHaveText(welcome.building.cvStates.none);
    await say(page, fr.questionnaire.answerLabel, "Directrice financière");
    await expect(buildingValue(page, welcome.building.targetRole)).toHaveText("Directrice financière");
    await expect(buildingValue(page, welcome.building.locations)).toHaveText(welcome.building.missing);

    // Born at its place: the offered Job Search starts, its progress in Activité in place of the Profile in construction.
    await say(page, fr.questionnaire.answerLabel, "Lyon");
    await expect(page.getByText(fr.newProfile.offeredSearchStarted)).toBeVisible();
    const jobSearchId = await offeredSearchOf(email);
    const now = activity.getByRole("region", { name: fr.aiActivity.live.now });
    const entry = now.getByRole("article", { name: `${fr.aiActivity.kinds.job_search} · Directrice financière` });
    await expect(entry).toBeVisible({ timeout: 15_000 });
    await expect(buildingOf(page)).toHaveCount(0);

    // Then its offers, with their Match Score in words.
    await measured(jobSearchId, await insertJobOffers("wide"));
    await expect(entry.getByText(fr.onboardingSearch.bestSoFar)).toBeVisible({ timeout: 15_000 });
    await expect(entry.locator(".activity-entry-offers li").first()).toContainText(/Match Score \d+\/100$/);
    // No card in the thread: the offers are Activité's on a wide screen.
    await expect(threadOf(page).getByRole("region", { name: welcome.offers.title })).toHaveCount(0);
  });
});

test.describe("the first welcome on a phone: the first offers in the thread (#1051)", () => {
  test.use({ viewport: PHONE });

  test("no split; once offers reach the threshold, a card lists up to 3 with « Voir toutes les offres »", async ({ page }) => {
    test.setTimeout(120_000);
    const email = newAddress("first-welcome-phone");
    await signInWithMagicLink(page, email);
    await page.goto("/profils/nouveau");
    await startWithoutCv(page);
    await expect(activityOf(page)).toHaveCount(0);
    for (const said of ["Directrice financière", "Lyon"]) await say(page, fr.questionnaire.answerLabel, said);
    await expect(page.getByText(fr.newProfile.offeredSearchStarted)).toBeVisible();
    const jobSearchId = await offeredSearchOf(email);
    // Offers found, none reaching the threshold (elsewhere than Lyon): no card, the coach's line stays.
    const elsewhere = page.waitForResponse((response) => response.url().includes(`/api/job-searches/${jobSearchId}/live`));
    const inBrest = await insertJobOffers("phone-elsewhere", "Brest");
    await measured(jobSearchId, inBrest);
    await elsewhere;
    const card = threadOf(page).getByRole("region", { name: welcome.offers.title });
    await expect(card).toHaveCount(0);
    await expect(page.getByText(fr.newProfile.offeredSearchStarted)).toBeVisible();

    // Then some in Lyon: the run analysed more, so the page asks for them.
    await measured(jobSearchId, [...inBrest, ...(await insertJobOffers("phone"))]);
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(activityOf(page)).toHaveCount(0);
    const offers = card.getByRole("listitem");
    await expect(offers).toHaveCount(3);
    await expect(offers.first()).toContainText(/Lyon · Match Score \d+\/100$/);
    await expect(offers.first().getByRole("link")).toHaveAttribute("href", new RegExp(`^/recherches/${jobSearchId}/offres/`));
    await expect(card.getByRole("link", { name: welcome.offers.all })).toHaveAttribute("href", `/recherches/${jobSearchId}`);
    await expect(page.getByText(fr.newProfile.offeredSearchStarted)).toBeVisible();
    // Said once to screen readers, by the page; the card itself is not read again as it changes.
    await expect(page.locator("p[aria-live='polite']").filter({ hasText: welcome.offers.announce })).toHaveCount(1);
    await expect(card.locator("xpath=ancestor::li[1]")).toHaveAttribute("aria-live", "off");
    // Reachable by the keyboard.
    await card.getByRole("link", { name: welcome.offers.all }).focus();
    await expect(card.getByRole("link", { name: welcome.offers.all })).toBeFocused();
  });
});

test.describe("« Ajouter un profil » (#1051): a finished Profile exists", () => {
  test.use({ viewport: WIDE });

  test("is not split: Activité closed as the page loads, as before", async ({ page }) => {
    // A Plan that allows a second Profile, so that the page is the interview, not the Upgrade prompt.
    const email = newAddress("first-welcome-add");
    await signInWithMagicLink(page, email);
    await subscribe(page, email, "standard");
    const created = await page.request.post("/api/profiles", {
      headers: { origin },
      data: {
        masterCv: {
          fullName: "Marie Dupont",
          headline: "Directrice financière",
          email: "marie.dupont@example.fr",
          phone: "",
          location: "Lyon",
          summary: "",
          experience: [{ title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2015 – 2024", description: "" }],
          education: [],
          skills: ["IFRS"],
          languages: [],
        },
        searchCriteria: { targetRole: "Directrice financière", locations: ["Lyon"], contractTypes: ["cdi"] },
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    await page.goto("/profils/nouveau");
    await expect(page.getByRole("button", { name: fr.newProfile.startQuestionnaire })).toBeVisible();
    await expect(activityButtonOf(page)).toHaveAttribute("aria-expanded", "false");
    await expect(activityOf(page)).toHaveCount(0);
  });
});
