import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

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

const aiActivityButton = (page: Page) => page.getByRole("banner").getByRole("button", { name: new RegExp(`^${fr.aiActivity.label}`) });
const paneOf = (page: Page) => page.getByRole("complementary", { name: fr.aiActivity.label });
/** The pane's « Par élément » entry whose title or kind says `label`. */
const elementOf = (page: Page, label: string | RegExp) => paneOf(page).locator(".ai-activity-element").filter({ hasText: label });

async function openPane(page: Page) {
  await aiActivityButton(page).click();
  await expect(paneOf(page).getByRole("heading", { name: fr.aiActivity.title })).toBeVisible();
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

    // No model served this page: the closed button shows its label, never « 0 modèle ».
    const button = aiActivityButton(page);
    await expect(page.getByRole("banner").locator(".ai-activity-summary")).toHaveCount(0);
    await expect(button).toContainText(fr.aiActivity.label);

    await openPane(page);
    const pane = paneOf(page);
    const score = elementOf(page, fr.aiActivity.kinds.ats_score);
    await expect(score).toHaveCount(1);
    await expect(score).toContainText(fr.aiActivity.steps.compute);
    await expect(score).not.toContainText(fr.aiActivity.modelNotRecorded);

    const fix = elementOf(page, "Ajoutez « Trésorerie » à vos compétences");
    await expect(fix).toHaveCount(1);
    await expect(fix).toContainText(fr.aiActivity.steps.compute);
    await expect(fix).not.toContainText(fr.aiActivity.modelNotRecorded);

    const old = elementOf(page, "Ancienne proposition");
    await expect(old).toContainText(fr.aiActivity.modelNotRecorded);
    await expect(old).not.toContainText(fr.aiActivity.steps.compute);

    // No model in the Modèles section: the rules are an Outil.
    await expect(pane.locator(".ai-activity-section").first()).not.toContainText(/Mistral|Claude|Perplexity/);
    await expect(pane.locator(".ai-activity-total")).toHaveCount(0);
  });

  test("a new Job Digest shows its Match Scores as « Calcul » with no model; one made before shows « non enregistré »", async ({ page }) => {
    const { candidateId } = await signIn(page, "digest-cards-digest");
    const profileId = await createProfile(page);
    const offerId = await storedJobOffer("DAF Lyon");
    const fresh = await storedDigest(candidateId, profileId, offerId, "2026-10-21T06:00:00Z", rules("match_score", "2026-10-21T06:00:00.000Z"));
    const before = await storedDigest(candidateId, profileId, offerId, "2026-10-14T06:00:00Z", null);

    await page.goto(`/job-digests/${fresh}`);
    await expect(page.getByRole("banner").locator(".ai-activity-summary")).toHaveCount(0);
    await openPane(page);
    const digest = elementOf(page, fr.aiActivity.kinds.job_digest);
    await expect(digest).toHaveCount(1);
    await expect(digest).toContainText(fr.aiActivity.steps.compute);
    await expect(digest).not.toContainText(fr.aiActivity.modelNotRecorded);

    await page.goto(`/job-digests/${before}`);
    await openPane(page);
    const old = elementOf(page, fr.aiActivity.kinds.job_digest);
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
    await page.getByLabel(fr.application.statusLabel).selectOption({ label: fr.applicationStatuses.applied });
    await expect(page.getByRole("status")).toHaveText(fr.application.statusSaved);

    for (const [title, provenance] of [["Relancer : nouvelle relance", WRITTEN], ["Relancer : ancienne relance", null]] as const) {
      await query(
        `INSERT INTO action_card (candidate_id, kind, title, body, focus_kind, focus_id, provenance) VALUES ($1, 'follow_up', $2, 'Bonjour', 'application', $3, $4)`,
        [candidateId, title, applicationId, provenance ? JSON.stringify(provenance) : null],
      );
    }
    await page.goto(`/candidatures/${applicationId}`);

    // The Job Offer was read by Mistral when saved, the Follow-up card written by Claude: both count; the older card adds nothing.
    await expect(aiActivityButton(page)).toHaveAccessibleName(/2 modèles/);
    await openPane(page);
    await expect(paneOf(page).locator(".ai-activity-section").first()).toContainText("Claude Sonnet 5");
    const written = elementOf(page, "Relancer : nouvelle relance");
    await expect(written).toHaveCount(1);
    await expect(written).toContainText("Claude Sonnet 5");
    await expect(written).not.toContainText(fr.aiActivity.modelNotRecorded);
    const old = elementOf(page, "Relancer : ancienne relance");
    await expect(old).toContainText(fr.aiActivity.modelNotRecorded);
    await expect(old).not.toContainText("Claude Sonnet 5");
  });
});
