import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #329: a Job Offer read from a link pasted in the Coach Panel keeps its Provenance (the page read, on the
// site of its page) and, being shared, names no Candidate. The careers site is faked inside the server
// (fake-coach-link-sites.mjs).
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const SITE = "https://carrieres.coach-links.e2e-jobbbox.fr";

test("a Job Offer read from a pasted link keeps its page read and names no Candidate (#329)", async ({ page }) => {
  await signInWithMagicLink(page, newAddress("coach-link-provenance"));
  const candidateId: string = (await (await page.request.get("/api/auth/get-session")).json()).user.id;
  const panel = page.getByRole("complementary", { name: fr.coachPanel.title });
  await page.getByRole("button", { name: fr.coachPanel.open, exact: true }).click();
  await panel.getByLabel(fr.coachPanel.messageLabel).fill(`Que pensez-vous de cette offre ? ${SITE}/offres/daf-lyon`);
  await panel.getByRole("button", { name: fr.coachPanel.send }).click();
  await expect(panel.getByRole("article", { name: fr.coachPanel.jobOfferLink.card })).toBeVisible();

  const client = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query("SELECT provenance, provenance::text AS text FROM job_offer WHERE source_url LIKE $1", [`${SITE}/offres/daf-lyon%`]);
    expect(rows).toHaveLength(1);
    const provenance = rows[0].provenance;
    expect(provenance, "the link read keeps a Provenance").not.toBeNull();
    expect(provenance.steps).toEqual([expect.objectContaining({ kind: "tool", activity: "read", outcome: "ok" })]);
    expect(provenance.sites).toEqual([expect.objectContaining({ kind: "web", domain: "carrieres.coach-links.e2e-jobbbox.fr" })]);
    expect(rows[0].text).not.toContain(candidateId);
  } finally {
    await client.end();
  }
});
