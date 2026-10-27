import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #443 (ADR-0049): a Job Offer from a recruiter's message is private to its Candidate. Only they get it from
// the API or its page; another Candidate, or a Guest, gets a 404 as if there were none, and capturing a posting from
// the same URL makes a shared Job Offer of its own. Nothing makes a private Job Offer from the app yet (Email intake
// will), so the test stores one in the database, as Email intake would, then drives the built web app.
const origin = process.env.E2E_WEB_ORIGIN!;
const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const url = `https://recruteur-e2e.example/mission/${tag}`;

async function query<T = Record<string, unknown>>(sql: string, values: unknown[] = []): Promise<T[]> {
  const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await db.connect();
  try {
    return (await db.query(sql, values)).rows as T[];
  } finally {
    await db.end();
  }
}

async function signedIn(browser: Browser, label: string): Promise<{ page: Page; candidateId: string }> {
  const page = await (await browser.newContext()).newPage();
  const email = newAddress(label);
  await signInWithMagicLink(page, email);
  const [row] = await query<{ id: string }>(`SELECT id FROM candidate WHERE email = $1`, [email]);
  return { page, candidateId: row!.id };
}

test("a private Job Offer is seen by its Candidate only: never by another Candidate, nor a Guest", async ({ browser, request }) => {
  const marie = await signedIn(browser, "privee-marie");
  const paul = await signedIn(browser, "privee-paul");
  const [stored] = await query<{ id: string }>(
    `INSERT INTO job_offer (url_key, content_fingerprint, source_url, source_name, title, content, private_to_candidate_id)
     VALUES ($1, $2, $3, 'recruteur-e2e.example', 'DAF H/F, client confidentiel', 'Mon client, un groupe lyonnais, cherche son DAF.', $4)
     RETURNING id`,
    [url.replace(/^https:\/\//, ""), `private-${tag}`, url, marie.candidateId],
  );
  const id = stored!.id;

  const hers = await marie.page.request.get(`/api/job-offers/${id}`);
  expect(hers.status()).toBe(200);
  expect(await hers.json()).toMatchObject({ id, title: "DAF H/F, client confidentiel" });
  await marie.page.goto(`/offres/${id}`);
  await expect(marie.page.getByText("Mon client, un groupe lyonnais, cherche son DAF.")).toBeVisible();

  expect((await paul.page.request.get(`/api/job-offers/${id}`)).status()).toBe(404);
  expect((await request.get(`/api/job-offers/${id}`)).status()).toBe(404);
  const theirPage = await paul.page.goto(`/offres/${id}`);
  expect(theirPage?.status()).toBe(404);
  await expect(paul.page.getByText("cherche son DAF")).toHaveCount(0);

  // Capturing the public posting from the same URL makes a shared Job Offer of its own, without the private one's text.
  const shared = await paul.page.request.post("/api/job-offers", {
    data: { source: { url }, title: "Directeur administratif et financier", content: `Annonce publique du poste ${tag}.` },
    headers: { origin },
  });
  expect(shared.status()).toBe(200);
  const sharedOffer = await shared.json();
  expect(sharedOffer.id).not.toBe(id);
  expect(sharedOffer).toMatchObject({ title: "Directeur administratif et financier", content: `Annonce publique du poste ${tag}.` });
  expect((await request.get(`/api/job-offers/${sharedOffer.id}`)).status()).toBe(200);
});
