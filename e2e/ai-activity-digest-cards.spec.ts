import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { activityButtonOf, activityOf, ficheOf, openActivity } from "./support/conversation";

// Issue #336: AI Activity reads a new Job Digest, a Follow-up card, an ATS Fix card and the ATS Score from their stored
// Provenance. The ATS Score and the ATS Fix (and a Job Digest's Match Scores) are made by Jobbbox's rules: « Calcul »,
// no model. Content made before the Provenance was kept shows « non enregistré ». Driven through the built web app.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;

const masterCv = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "06 12 34 56 78",
  location: "Lyon",
  summary: "J'ai piloté la trésorerie d'un groupe coté.",
  experience: [{ title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2015 – 2024", description: "Budget et consolidation." }],
  education: [{ degree: "Master Finance", institution: "ESSEC", year: "1998" }],
  skills: ["IFRS", "SAP", "Budget", "Consolidation", "Reporting", "Contrôle de gestion", "Clôture", "ERP"],
  languages: [{ name: "Anglais", level: "courant" }],
};

/** What Jobbbox's rules leave: one « compute » step, no model. */
const rules = (rule: string, at: string) => ({
  v: 1,
  steps: [{ kind: "rules", activity: "compute", rule, ms: 8, at, outcome: "ok", count: 1 }],
  sites: [],
  startedAt: at,
  wallMs: 8,
});

/** A Follow-up draft written by Claude Sonnet on Bedrock in Stockholm. */
const WRITTEN = {
  v: 1,
  steps: [
    { kind: "ai", activity: "write", task: "writing", provider: "anthropic", endpoint: "bedrock eu-north-1", model: "anthropic.claude-sonnet-5", tokens: { input: 900, output: 120 }, ms: 2100, at: "2026-11-12T06:00:00.000Z", outcome: "ok", count: 1 },
  ],
  sites: [],
  startedAt: "2026-11-12T06:00:00.000Z",
  wallMs: 2100,
};

async function query<T = Record<string, unknown>>(sql: string, values: unknown[] = []): Promise<T[]> {
  const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await db.connect();
  try {
    return (await db.query(sql, values)).rows as T[];
  } finally {
    await db.end();
  }
}

async function signIn(page: Page, label: string): Promise<{ email: string; candidateId: string }> {
  const email = newAddress(label);
  await signInWithMagicLink(page, email);
  const [row] = await query<{ id: string }>(`SELECT id FROM candidate WHERE email = $1`, [email]);
  return { email, candidateId: row!.id };
}

async function createProfile(page: Page): Promise<string> {
  const created = await page.request.post("/api/profiles", {
    headers: { origin },
    data: { masterCv, searchCriteria: { targetRole: "Directrice financière", locations: ["Lyon"] } },
  });
  expect(created.status()).toBe(201);
  return (await created.json()).id;
}

/** « Activité » in the Top Bar (#603, #607): the way to the page's AI Activity since the Coach Panel left (#608). */
const aiActivityButton = (page: Page) => activityButtonOf(page);
/** Where the page's AI Activity shows: an object's Fiche, in its Activity group, or the Activité column. */
const paneOf = (page: Page) => activityOf(page);
/** The history's entry whose title says `label` (#808). */
const entryOf = (page: Page, label: string | RegExp) => paneOf(page).locator(".activity-entry").filter({ has: page.locator(".activity-entry-title").filter({ hasText: label }) });
/** That entry, its detail unfolded: its steps, models and cost. */
async function elementOf(page: Page, label: string | RegExp) {
  const entry = entryOf(page, label);
  await expect(entry).toHaveCount(1);
  const row = entry.locator(".activity-entry-row");
  if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
  return entry;
}

async function openPane(page: Page) {
  await openActivity(page);
  await expect(paneOf(page).locator(".fiche-activity")).toBeVisible();
}

async function storedJobOffer(title: string): Promise<string> {
  const [row] = await query<{ id: string }>(
    `INSERT INTO job_offer (content_fingerprint, title, content, employer) VALUES ($1, $2, 'Vous pilotez la finance du groupe.', 'Groupe Seb') RETURNING id`,
    [`digest-cards-${Math.random()}`, title],
  );
  return row!.id;
}

async function storedDigest(candidateId: string, profileId: string, offerId: string, sentAt: string, provenance: unknown): Promise<string> {
  const [row] = await query<{ id: string }>(
    `INSERT INTO job_digest (profile_id, candidate_id, job_offer_ids, sent_at, provenance) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [profileId, candidateId, [offerId], sentAt, provenance ? JSON.stringify(provenance) : null],
  );
  return row!.id;
}

test.describe("AI Activity: Job Digests and Action Cards (#336)", () => {
  // Wide enough for the Fiche, where AI Activity shows, beside a Section open in the Work Pane (Fiche.tsx).
  test.use({ viewport: { width: 1600, height: 1000 } });

  test("a new ATS Score and its ATS Fix cards show as « Calcul » with no model, and an Action Card made before shows « non enregistré »", async ({ page }) => {
    const { candidateId } = await signIn(page, "digest-cards-ats");
    const profileId = await createProfile(page);
    await page.goto(`/profils/${profileId}/ats-score`);
    await page.getByRole("region", { name: fr.atsScore.title }).getByRole("button", { name: fr.atsScore.compute }).click();
    await expect(page).toHaveURL(`${origin}/profils/${profileId}/propositions`);
    await expect(page.getByRole("region", { name: fr.actionCards.title }).getByRole("article", { name: "Ajoutez « Trésorerie » à vos compétences" })).toBeVisible();

    // An Action Card proposed before the Provenance was kept: no column value.
    await query(
      `INSERT INTO action_card (candidate_id, kind, title, body, focus_kind, focus_id, provenance) VALUES ($1, 'ats_fix', 'Ancienne proposition', 'Corps', 'profile', $2, NULL)`,
      [candidateId, profileId],
    );
    await page.reload();

    // No model served this page: « Activité » says its name alone, never « 0 modèle ».
    await expect(aiActivityButton(page)).toHaveText(fr.fiche.activity);

    await openPane(page);
    const pane = paneOf(page);
    // Version 1's ATS Score is a part of « Création du profil » (#810).
    const score = (await elementOf(page, fr.aiActivity.kinds.profile_creation)).locator('.activity-entry-part[data-kind="ats_score"]');
    await expect(score).toContainText(fr.aiActivity.steps.compute);
    await expect(score).not.toContainText(fr.aiActivity.modelNotRecorded);

    const fix = await elementOf(page, "Ajoutez « Trésorerie » à vos compétences");
    await expect(fix).toContainText(fr.aiActivity.steps.compute);
    await expect(fix).not.toContainText(fr.aiActivity.modelNotRecorded);

    const old = await elementOf(page, "Ancienne proposition");
    await expect(old).toContainText(fr.aiActivity.modelNotRecorded);
    await expect(old).not.toContainText(fr.aiActivity.steps.compute);

    // No entry names a model: the rules are a Tool, « Sans IA ».
    await expect(pane).not.toContainText(/Mistral|Claude|Perplexity/);
    await expect(score).toContainText(fr.aiActivity.history.cost.noAi);
  });

  test("a new Job Digest shows its Match Scores as « Calcul » with no model; one made before shows « non enregistré »", async ({ page }) => {
    const { candidateId } = await signIn(page, "digest-cards-digest");
    const profileId = await createProfile(page);
    const offerId = await storedJobOffer("DAF Lyon");
    const fresh = await storedDigest(candidateId, profileId, offerId, "2026-10-21T06:00:00Z", rules("match_score", "2026-10-21T06:00:00.000Z"));
    const before = await storedDigest(candidateId, profileId, offerId, "2026-10-14T06:00:00Z", null);

    await page.goto(`/job-digests/${fresh}`);
    await expect(aiActivityButton(page)).toHaveText(fr.fiche.activity);
    await openPane(page);
    const digest = await elementOf(page, fr.aiActivity.kinds.job_digest);
    await expect(digest).toContainText(fr.aiActivity.steps.compute);
    await expect(digest).not.toContainText(fr.aiActivity.modelNotRecorded);

    await page.goto(`/job-digests/${before}`);
    await openPane(page);
    const old = await elementOf(page, fr.aiActivity.kinds.job_digest);
    await expect(old).toContainText(fr.aiActivity.modelNotRecorded);
    await expect(old).not.toContainText(fr.aiActivity.steps.compute);
  });

  test("a Follow-up card shows the model that wrote its draft and counts in the button; a card made before shows « non enregistré »", async ({ page }) => {
    const { candidateId } = await signIn(page, "digest-cards-follow");
    const profileId = await createProfile(page);
    const offerId = await storedJobOffer("DAF Lyon");
    const saved = await page.request.post("/api/applications", { data: { jobOfferId: offerId, profileId }, headers: { origin } });
    expect(saved.ok(), await saved.text()).toBe(true);
    const applicationId = (await saved.json()).id as string;
    // A Follow-up card applies while the Application waits (« Postulée »).
    await page.goto(`/candidatures/${applicationId}`);
    await ficheOf(page).getByLabel(fr.application.statusLabel).selectOption({ label: fr.applicationStatuses.applied });
    await expect(ficheOf(page).getByRole("status")).toHaveText(fr.application.statusSaved);

    for (const [title, provenance] of [["Relancer : nouvelle relance", WRITTEN], ["Relancer : ancienne relance", null]] as const) {
      await query(
        `INSERT INTO action_card (candidate_id, kind, title, body, focus_kind, focus_id, provenance) VALUES ($1, 'follow_up', $2, 'Bonjour', 'application', $3, $4)`,
        [candidateId, title, applicationId, provenance ? JSON.stringify(provenance) : null],
      );
    }
    // The Job Offer read by Mistral, its Job Offer Summary written as its Section is shown (#603).
    await page.goto(`/candidatures/${applicationId}/offre`);
    await expect(page.locator(`dl[aria-label="${fr.jobOffer.summaryLabel}"]`)).toBeVisible();
    await page.goto(`/candidatures/${applicationId}`);

    // The Job Offer was read by Mistral, the Follow-up card written by Claude: each entry names its own model.
    await openPane(page);
    await expect(await elementOf(page, fr.aiActivity.kinds.job_offer)).toContainText("Mistral");
    const written = await elementOf(page, "Relancer : nouvelle relance");
    await expect(written).toContainText("Claude Sonnet 5");
    await expect(written).not.toContainText(fr.aiActivity.modelNotRecorded);
    const old = await elementOf(page, "Relancer : ancienne relance");
    await expect(old).toContainText(fr.aiActivity.modelNotRecorded);
    await expect(old).not.toContainText("Claude Sonnet 5");
  });
});
