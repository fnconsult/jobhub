import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { MARIE_DUPONT_CV, pdfCv } from "../apps/web/src/cv/test-support";
import { signInWithMagicLink } from "./support/candidate";
import { activityOf, closeActivity, unfoldedEntryOf } from "./support/conversation";
import { newAddress } from "./support/mailbox";
import { onboardingSummary, throughCvInterview } from "./support/onboarding-summary";

// Issue #1006 (ADR-0106, map #992): creating a Profile, end to end. A CV read by the AI Coach, the questions on what it
// does not say, the summary, « Cela semble correct », then the first offers, at the end of the offered Job Search's entry
// in « Activité », which a line of the coach opens (« Dans l'activité »). The AI is faked inside the server
// (fake-mistral.mjs); no worker runs here, so the search is simulated as its worker reports it: its run's measures while
// it searches (`job_search.live`), then its outcome (done, its Job Offers, its notification pending).
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
/** One run's Job Offers, kept apart from another run's in the same database. */
const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const CV = { name: "CV-Marie-Dupont.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdfCv(MARIE_DUPONT_CV)) };

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

/**
 * Job Offers as the search found them, for the target role the Profile was born with (as fake-mistral read it), in Lyon:
 * what its Match Score finds matching.
 */
async function insertJobOffers(batch: string, targetRole: string): Promise<string[]> {
  const offers = [
    { title: targetRole, employer: "Groupe Ferlac", site: "apec.fr" },
    { title: `${targetRole} groupe`, employer: "Valrhône Industrie", site: "welcometothejungle.com" },
    { title: `${targetRole} adjointe`, employer: "Lumen Santé", site: "francetravail.fr" },
  ];
  const ids: string[] = [];
  for (const [index, offer] of offers.entries()) {
    const key = `${tag}-${batch}-${index}`;
    const [row] = await query<{ id: string }>(
      `INSERT INTO job_offer (url_key, content_fingerprint, source_url, source_name, title, content, employer, location, contract_type, remote_work,
         salary_min, salary_max, skills, required_experience_years, posted_at, text_read_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'Lyon', 'cdi', 'hybrid', 90000, 110000, $8, 8, now(), now()) RETURNING id`,
      [
        `${offer.site}/offres/${key}`,
        `onboarding-first-offers-${key}`,
        `https://www.${offer.site}/offres/${key}`,
        offer.site,
        offer.title,
        `${offer.employer} recrute sa directrice financière à Lyon : consolidation, IFRS, SAP, management d'équipe.`,
        offer.employer,
        ["Consolidation", "IFRS"],
      ],
    );
    ids.push(row!.id);
  }
  return ids;
}

/** The run's measures, written on the Job Search as its worker writes them while it searches. */
async function measured(jobSearchId: string, jobOfferIds: string[]): Promise<void> {
  const live = {
    step: "analysis",
    sources: [
      { source: "france_travail", state: "searched" },
      { source: "fantastic_jobs", state: "searched" },
      { source: "web_search", state: "searching" },
    ],
    pagesRead: 12,
    offersAnalysed: jobOfferIds.length,
    matched: null,
    jobOfferIds,
  };
  await query("UPDATE job_search SET live = $2::jsonb WHERE id = $1", [jobSearchId, JSON.stringify(live)]);
}

/** Its outcome, recorded as the worker records a run done (JobSearches.record): its Job Offers, its notification pending. */
async function done(jobSearchId: string, jobOfferIds: string[]): Promise<void> {
  const metrics = {
    funnel: { providerUrls: jobOfferIds.length, fetched: jobOfferIds.length, extracted: jobOfferIds.length, alreadyStored: 0, afterDedup: jobOfferIds.length, matched: jobOfferIds.length },
    skipped: {},
    costEur: 0,
    durationMs: 60_000,
  };
  await query(
    `UPDATE job_search SET status = 'done', job_offer_ids = $2, finished_at = now(), metrics = $3::jsonb, notification_pending = true, progress = NULL
      WHERE id = $1 AND status = 'searching'`,
    [jobSearchId, jobOfferIds, JSON.stringify(metrics)],
  );
}

/**
 * Signs a new Candidate in, sends Marie Dupont's CV, checks its reading in Activité, confirms the target role and the
 * place it read and skips what a CV does not say (#1003), up to the summary (#1004); returns the offered Job Search the Profile born started (#1000).
 */
async function upToSummary(page: Page, label: string): Promise<{ email: string; jobSearchId: string; profileId: string; targetRole: string }> {
  const email = newAddress(label);
  await signInWithMagicLink(page, email);
  await page.goto("/profils/nouveau");
  await page.getByLabel(fr.cvUpload.fileLabel).setInputFiles(CV);
  await page.getByRole("button", { name: fr.cvUpload.submit }).click();
  // The CV read in Activité (#1003): « Création du profil »'s part « Lecture du CV », with the fields it read.
  const thread = page.getByRole("list", { name: fr.questionnaire.transcript });
  await expect(thread.getByText(fr.newProfile.fromCv.questionsStart)).toBeVisible({ timeout: 15_000 });
  const reading = (await unfoldedEntryOf(page, new RegExp(`^${fr.aiActivity.kinds.profile_creation}$`))).locator('[data-kind="cv_reading"]');
  await expect(reading.getByRole("definition").filter({ hasText: "Directrice financière (lu par l'IA)" })).toBeVisible();
  // Then the questions on what it does not say, up to the summary.
  await throughCvInterview(page);
  await expect(onboardingSummary(page).locator(".onb-summary")).toContainText("Directrice financière");
  let search: { id: string; profile_id: string; target_role: string } | undefined;
  await expect
    .poll(async () => {
      [search] = await query<{ id: string; profile_id: string; target_role: string }>(
        `SELECT s.id, s.profile_id, p.target_role
           FROM job_search s JOIN candidate c ON c.id = s.candidate_id JOIN profile p ON p.id = s.profile_id
          WHERE c.email = $1 AND s.offered = 'first'`,
        [email],
      );
      return search?.id ?? null;
    })
    .not.toBeNull();
  return { email, jobSearchId: search!.id, profileId: search!.profile_id, targetRole: search!.target_role };
}

/** The offered search's entry while it runs: « Recherche d'offres · Directrice financière » in « En ce moment ». */
const runningEntry = (page: Page) =>
  activityOf(page)
    .getByRole("region", { name: fr.aiActivity.live.now })
    .getByRole("article", { name: `${fr.aiActivity.kinds.job_search} · Directrice financière` });

/** « Cela semble correct »: the Profile saved, the coach's line on the first offers under it (#1006). */
async function confirm(page: Page) {
  await onboardingSummary(page).getByRole("button", { name: fr.onboardingSummary.confirm, exact: true }).click();
  const thread = page.getByRole("list", { name: fr.questionnaire.transcript });
  await expect(thread.getByRole("link", { name: fr.onboardingSummary.toProfile, exact: true })).toBeVisible();
  const line = thread.locator("li.chat-coach").filter({ hasText: fr.newProfile.firstOffers });
  await expect(line).toBeVisible();
  // Text only, as every line of the coach: no card of its own in the thread.
  await expect(line.locator(".ds-card")).toHaveCount(0);
  return line;
}

/** Its history entry once over: « Dans l'activité » opens Activity on it, unfolded. */
async function endedEntryFrom(page: Page, line: Awaited<ReturnType<typeof confirm>>) {
  const row = activityOf(page).getByRole("button", { name: new RegExp(`^${fr.aiActivity.kinds.job_search} · Directrice financière`) });
  // The poll brings its end: the entry leaves « En ce moment » for the page's history.
  await expect(row).toBeVisible({ timeout: 15_000 });
  await closeActivity(page);
  await line.getByRole("button", { name: fr.aiActivity.history.inActivity, exact: true }).click();
  await expect(row).toHaveAttribute("aria-expanded", "true");
  return activityOf(page).locator(`#${await row.getAttribute("aria-controls")}`);
}

test.describe("creating a Profile, end to end: from the CV to the first offers in Activity (#1006)", () => {
  test("CV → questions on what is missing → summary → « Cela semble correct » → the best Job Offers in the Activité entry", async ({ page }) => {
    const { jobSearchId, targetRole } = await upToSummary(page, "first-offers");

    // While it searches: « ici » in « En ce moment », its best Job Offers so far as they are found, and the Candidate may go on.
    const jobOfferIds = await insertJobOffers("found", targetRole);
    await measured(jobSearchId, jobOfferIds);
    const entry = runningEntry(page);
    if ((await entry.count()) === 0) await page.getByRole("banner").getByRole("button", { name: new RegExp(`^${fr.aiActivity.label}`) }).click();
    await expect(entry.getByText(fr.onboardingSearch.bestSoFar)).toBeVisible({ timeout: 15_000 });
    await expect(entry.getByRole("link", { name: targetRole, exact: true })).toHaveAttribute("href", new RegExp(`^/recherches/${jobSearchId}/offres/`));
    await expect(entry.getByText(fr.onboardingSearch.running)).toBeVisible();
    // « offres qui vous correspondent »: the three, by Match Score against the criteria of the moment.
    await expect(entry.locator(".ds-stat__value").last()).toHaveText("3");

    // « Cela semble correct »: one line of the coach points to Activity; « Continuer vers mon profil » stays possible.
    const line = await confirm(page);

    // Done: its entry ends with its best Job Offers, by Match Score, and « Voir toutes les offres », the Job Search's page.
    await done(jobSearchId, jobOfferIds);
    const detail = await endedEntryFrom(page, line);
    await expect(detail.getByText(fr.aiActivity.history.bestOffers)).toBeVisible();
    const offers = detail.locator(".activity-entry-offers li");
    await expect(offers).toHaveCount(3);
    await expect(offers.first()).toContainText(/Match Score \d+\/100$/);
    await expect(detail.getByRole("button", { name: fr.aiActivity.history.noMatch.searchAgain })).toHaveCount(0);
    await detail.getByRole("link", { name: fr.aiActivity.history.allOffers }).click();
    await expect(page).toHaveURL(`${origin}/recherches/${jobSearchId}`);
  });

  test("no Job Offer that matches: the entry says so, with « Voir mon profil » and « Relancer une recherche », which counts in the Plan Quota", async ({ page }) => {
    const { email, jobSearchId, profileId } = await upToSummary(page, "first-offers-none");
    const line = await confirm(page);

    await done(jobSearchId, []);
    const detail = await endedEntryFrom(page, line);
    await expect(detail.getByText(fr.aiActivity.history.noMatch.text)).toBeVisible();
    await expect(detail.getByText(fr.aiActivity.history.bestOffers)).toHaveCount(0);
    await expect(detail.getByRole("link", { name: fr.aiActivity.history.noMatch.profile })).toHaveAttribute("href", `/profils/${profileId}`);
    await expect(detail.getByText(fr.aiActivity.history.noMatch.quota)).toBeVisible();

    // Unlike the offered one, the new search uses the week's Plan Quota.
    await detail.getByRole("button", { name: fr.aiActivity.history.noMatch.searchAgain }).click();
    await expect(page).toHaveURL(/\/recherches\/[0-9a-f-]{36}$/);
    expect(page.url()).not.toContain(jobSearchId);
    const [use] = await query<{ used: number }>(
      "SELECT coalesce(sum(u.used), 0)::int AS used FROM quota_usage u JOIN candidate c ON c.id = u.candidate_id WHERE c.email = $1 AND u.quota = 'jobSearches'",
      [email],
    );
    expect(use!.used).toBe(1);
  });
});
