import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import AxeBuilder from "./support/axe";
import { signInWithMagicLink } from "./support/candidate";
import { panelIconOf } from "./support/conversation";
import { newAddress } from "./support/mailbox";

// A Job Digest's « Offres trouvées » shows its Job Offers as Recherches d'offres does (the Offer box's lines: Match Score,
// title, employer and place, source and age, « Suivre », « Écarter », « Plus tard », « Lire l'offre »), without the box's
// header and source chips. « Lire l'offre » opens the Job Offer in the Work Pane on the Job Digest's page, where its
// left edge resizes it.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
const DESKTOP = { width: 1440, height: 900 };

async function query<T extends pg.QueryResultRow>(sql: string, values: unknown[]): Promise<T[]> {
  const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await db.connect();
  try {
    return (await db.query<T>(sql, values)).rows;
  } finally {
    await db.end();
  }
}

/** A Candidate with a Job Digest that brought two Job Offers, each in the Offer box, à traiter; the Job Digest's id. */
async function jobDigestWithOffers(page: Page): Promise<{ digestId: string; jobOfferIds: string[] }> {
  await signInWithMagicLink(page, newAddress("found-offers"));
  const candidateId = (await (await page.request.get("/api/auth/get-session")).json()).user.id as string;
  const profile = await page.request.post("/api/profiles", {
    data: {
      masterCv: { fullName: "Hélène Garnier", headline: "Head of BU", email: "helene.garnier@example.fr", phone: "", location: "Paris", summary: "", experience: [], education: [], skills: [], languages: [] },
      searchCriteria: { targetRole: "Head of BU / Professional Services", locations: ["Paris"] },
    },
    headers: { origin },
  });
  expect(profile.status(), await profile.text()).toBe(201);
  const profileId = (await profile.json()).id as string;
  const jobOfferIds: string[] = [];
  for (const [title, employer] of [
    ["Service Delivery Director", "nLighten"],
    ["Programmatic Account Manager H/F - CDI", "wppmedia"],
  ]) {
    const captured = await page.request.post("/api/job-offers", {
      data: { source: { url: `https://jobs.example.fr/${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }, title, content: `${title} chez ${employer}.`, employer, location: "Paris" },
      headers: { origin },
    });
    expect(captured.status(), await captured.text()).toBe(200);
    jobOfferIds.push((await captured.json()).id);
  }
  // What the worker leaves behind, which no public endpoint stores: the Job Digest, and its arrivals in the Offer box.
  const [digest] = await query<{ id: string }>("INSERT INTO job_digest (candidate_id, profile_id, job_offer_ids, sent_at) VALUES ($1, $2, $3, now()) RETURNING id", [candidateId, profileId, jobOfferIds]);
  await query(
    `INSERT INTO offer_box_entry (candidate_id, job_offer_id, profile_id, first_arrival_at, arrival_sources)
     SELECT $1, id, $2, now(), jsonb_build_object('job_digest', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
       FROM unnest($3::uuid[]) AS found (id)`,
    [candidateId, profileId, jobOfferIds],
  );
  return { digestId: digest!.id, jobOfferIds };
}

test.describe("a Job Digest's « Offres trouvées », as Recherches d'offres shows them", () => {
  test("lists its Job Offers as the Offer box's lines, without its filters; « Lire l'offre » opens one in the Work Pane", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    const { digestId, jobOfferIds } = await jobDigestWithOffers(page);
    await page.goto(`/job-digests/${digestId}`);
    await panelIconOf(page, fr.fiche.views.offers).click();
    const panel = page.getByRole("complementary", { name: fr.fiche.views.offers, exact: true });
    await expect(panel).toBeVisible();

    const line = panel.getByRole("listitem", { name: "Service Delivery Director" });
    await expect(line).toBeVisible();
    await expect(line.getByText("nLighten · Paris")).toBeVisible();
    await expect(line.getByText(fr.offerBox.sources.job_digest, { exact: true })).toBeVisible();
    await expect(line.getByRole("button", { name: new RegExp(`^${fr.offerBox.later}`) })).toBeVisible();
    await expect(panel.getByRole("listitem", { name: "Programmatic Account Manager H/F - CDI" })).toBeVisible();
    // No header: no count, no progress, no source chips.
    await expect(panel.getByRole("progressbar")).toHaveCount(0);
    await expect(panel.getByRole("group", { name: fr.offerBox.chips })).toHaveCount(0);
    // Nothing runs past the panel at its narrowest.
    expect(await panel.evaluate((el) => el.querySelector(".fiche-body")!.scrollWidth <= el.querySelector(".fiche-body")!.clientWidth + 1)).toBe(true);

    const axe = await new AxeBuilder({ page }).include(".side-panel").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(axe.violations.map(({ id }) => id)).toEqual([]);

    await line.getByRole("link", { name: fr.offerBox.read }).click();
    await expect(page).toHaveURL(new RegExp(`/job-digests/${digestId}/offres/${jobOfferIds[0]}$`));
    const pane = page.locator("aside.work-pane");
    await expect(pane.getByRole("heading", { level: 2, name: "Service Delivery Director" })).toBeFocused();
    const handle = page.getByRole("separator", { name: fr.conversationFirst.resize });
    await handle.focus();
    const before = Math.round((await pane.boundingBox())!.width);
    await page.keyboard.press("ArrowLeft");
    expect(Math.round((await pane.boundingBox())!.width)).toBeGreaterThan(before);

    // « Plus tard » acts as it does in Recherches d'offres: the entry leaves what is à traiter until Monday.
    await page.goto(`/job-digests/${digestId}`);
    await panelIconOf(page, fr.fiche.views.offers).click();
    await panel.getByRole("listitem", { name: "Programmatic Account Manager H/F - CDI" }).getByRole("button", { name: new RegExp(`^${fr.offerBox.later}`) }).click();
    await expect.poll(async () => (await (await page.request.get("/api/offer-box")).json()).entries.find((entry: { jobOffer: { id: string } }) => entry.jobOffer.id === jobOfferIds[1])?.state).toBe("later");
  });
});
