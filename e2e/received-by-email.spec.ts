import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { subscribe } from "./support/plan";

// Issue #447: Recherches d'offres shows, per Profile, the Job Offers Email intake gave it (« Reçues par email »,
// newest first, with how many arrived this week), « Non classées », the emails ignored this week with their reason,
// sender's domain and date, and « Filtre trop large » past the daily threshold. The worker's reading is #445's spec:
// here the Received offer emails are seeded in the database as the worker leaves them once read (outcome, sender's
// domain, dates and the offers they gave, never a text), then the built web app is driven in a browser, in French.
const origin = process.env.E2E_WEB_ORIGIN!;
const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const masterCv = {
  fullName: "Bérénice Castafiore",
  headline: "Directrice financière",
  email: "berenice.castafiore@example.fr",
  phone: "",
  location: "Lyon",
  summary: "Vingt ans à la tête des finances d'un groupe industriel.",
  experience: [{ title: "Directrice financière", employer: "Moulinsart Industries", location: "Lyon", period: "2004 – 2024", description: "Pilotage financier du groupe." }],
  education: [],
  skills: ["Consolidation", "IFRS"],
  languages: [],
};

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

async function profile(page: Page, targetRole: string): Promise<string> {
  const created = await page.request.post("/api/profiles", { headers: { origin }, data: { masterCv, searchCriteria: { targetRole, locations: ["Lyon"], contractTypes: ["cdi"] } } });
  expect(created.status(), await created.text()).toBe(201);
  return (await created.json()).id as string;
}

/** A Job Offer as Email intake stores one: shared from an alert, private to `privateTo` from a recruiter's message. */
async function jobOffer(title: string, employer: string, privateTo: string | null = null): Promise<string> {
  const url = `https://emploi-e2e.example/${tag}/${encodeURIComponent(title)}`;
  const [row] = await query<{ id: string }>(
    `INSERT INTO job_offer (url_key, content_fingerprint, source_url, source_name, title, content, employer, location, contract_type, private_to_candidate_id)
     VALUES ($1, $2, $3, 'emploi-e2e.example', $4, $5, $6, 'Lyon', 'cdi', $7) RETURNING id`,
    [url.replace(/^https:\/\//, ""), `${tag}-${title}`, url, title, `${title} chez ${employer}. Poste basé à Lyon.`, employer, privateTo],
  );
  return row!.id;
}

/** A Received offer email as the worker leaves it once read: its outcome, sender's domain, dates and the offers it gave. */
async function receivedEmail(candidateId: string, outcome: string, senderDomain: string, offers: { jobOfferId: string; profileId: string | null; matchScore: number }[] = []) {
  const id = `${tag}-${Math.random().toString(36).slice(2)}`;
  await query(
    `INSERT INTO received_offer_email (id, candidate_id, message_id, outcome, kind, sender_domain, received_at, read_at)
     VALUES ($1, $2, $3, $4, $5, $6, now(), now())`,
    [id, candidateId, `<${id}@mail.example.test>`, outcome, offers.length > 0 ? "alert" : null, senderDomain],
  );
  for (const [position, offer] of offers.entries()) {
    await query(
      `INSERT INTO received_offer_email_offer (received_offer_email_id, position, candidate_id, disposition, job_offer_id, profile_id, match_score)
       VALUES ($1, $2, $3, 'new', $4, $5, $6)`,
      [id, position, candidateId, offer.jobOfferId, offer.profileId, offer.matchScore],
    );
  }
}

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => node.target.join(" ")) }))).toEqual([]);
}

test("a Candidate with Received offer emails sees each offer under its Profile, « Non classées », the emails ignored this week and their reasons (#447)", async ({ page, browser }) => {
  const email = newAddress("received-by-email");
  await signInWithMagicLink(page, email);
  const candidateId = (await (await page.request.get("/api/auth/get-session")).json()).user.id as string;
  await subscribe(page, email, "premium"); // two Profiles
  const daf = await profile(page, "Directrice administrative et financière");
  const consultant = await profile(page, "Consultante en transformation financière");
  expect((await page.request.put("/api/account/email-intake", { headers: { origin } })).status()).toBe(200);

  const paul = await (await browser.newContext({ baseURL: origin })).newPage();
  await signInWithMagicLink(paul, newAddress("received-by-email-paul"));
  const paulId = (await (await paul.request.get("/api/auth/get-session")).json()).user.id as string;

  const forDaf = await jobOffer(`DAF groupe industriel ${tag}`, "Moulinsart Industries");
  const fromRecruiter = await jobOffer(`DAF filiale, client confidentiel ${tag}`, "Cabinet Tournesol", candidateId);
  const forConsultant = await jobOffer(`Consultante transformation ${tag}`, "Haddock Conseil");
  const unclassified = await jobOffer(`Assistante de direction ${tag}`, "Séraphin Lampion SA");
  const paulsPrivate = await jobOffer(`Offre privée de Paul ${tag}`, "Cabinet Rastapopoulos", paulId);

  await receivedEmail(candidateId, "offers_found", "alertes.cadremploi.fr", [
    { jobOfferId: forDaf, profileId: daf, matchScore: 82 },
    { jobOfferId: forConsultant, profileId: consultant, matchScore: 74 },
    { jobOfferId: unclassified, profileId: null, matchScore: 31 },
  ]);
  await receivedEmail(candidateId, "offers_found", "tournesol-recrutement.example", [
    { jobOfferId: fromRecruiter, profileId: daf, matchScore: 77 },
    // Never trusted to show another Candidate's private Job Offer.
    { jobOfferId: paulsPrivate, profileId: daf, matchScore: 90 },
  ]);
  await receivedEmail(candidateId, "other", "jobijoba.com");
  await receivedEmail(candidateId, "unrecognised_sender", "inconnu.example");
  await receivedEmail(candidateId, "failed", "welcometothejungle.com");
  await receivedEmail(candidateId, "guardrail", "piege.example");
  await receivedEmail(paulId, "other", "paul-only.example");

  await page.goto(`/recherches?profil=${daf}`);
  const received = page.getByRole("region", { name: "Reçues par email" });
  await expect(received).toBeVisible();
  await expect(received.getByText("2 nouvelles cette semaine")).toBeVisible();
  const listed = received.getByRole("list", { name: /Offres reçues par email pour/ }).getByRole("listitem");
  await expect(listed).toHaveCount(2);
  // Newest first: the recruiter's private offer came in the later email.
  await expect(listed.nth(0).getByRole("link", { name: `DAF filiale, client confidentiel ${tag}` })).toBeVisible();
  await expect(listed.nth(1).getByRole("link", { name: `DAF groupe industriel ${tag}` })).toBeVisible();
  await expect(page.getByText(`Offre privée de Paul ${tag}`)).toHaveCount(0);
  await expect(received.getByText(`Consultante transformation ${tag}`)).toHaveCount(0);

  const unclassifiedSection = page.getByRole("region", { name: "Non classées" });
  await expect(unclassifiedSection.getByRole("link", { name: `Assistante de direction ${tag}` })).toBeVisible();
  await expect(unclassifiedSection.getByText("Meilleure correspondance : 31 sur 100")).toBeVisible();

  const ignored = page.getByRole("region", { name: "4 mails ignorés cette semaine" });
  const reasons = ignored.getByRole("list", { name: "Mails ignorés cette semaine" }).getByRole("listitem");
  await expect(reasons).toHaveCount(4);
  await expect(reasons.filter({ hasText: "Autre : jobijoba.com" })).toHaveCount(1);
  await expect(reasons.filter({ hasText: "Expéditeur non reconnu : inconnu.example" })).toHaveCount(1);
  await expect(reasons.filter({ hasText: "Échec : welcometothejungle.com" })).toHaveCount(1);
  await expect(reasons.filter({ hasText: "Écarté par un garde-fou : piege.example" })).toHaveCount(1);
  await expect(ignored.getByText("paul-only.example")).toHaveCount(0);
  await expect(page.getByText("Filtre trop large")).toHaveCount(0);
  await expectNoAxeViolations(page);

  await page.goto(`/recherches?profil=${consultant}`);
  const theirs = page.getByRole("region", { name: "Reçues par email" });
  await expect(theirs.getByRole("link", { name: `Consultante transformation ${tag}` })).toBeVisible();
  await expect(theirs.getByText(`DAF groupe industriel ${tag}`)).toHaveCount(0);

  // Every Profile at once: each one's offers in its own group.
  await page.goto("/recherches?profil=tous&vue=couloirs");
  await expect(page.getByRole("region", { name: "Reçues par email" })).toHaveCount(2);
  await expectNoAxeViolations(page);
});

test("past the daily threshold of emails, the Candidate is told their filter is too broad and led to the forwarding wizard (#447)", async ({ page }) => {
  const email = newAddress("received-by-email-broad");
  await signInWithMagicLink(page, email);
  const candidateId = (await (await page.request.get("/api/auth/get-session")).json()).user.id as string;
  const daf = await profile(page, "Directrice administrative et financière");
  // EMAIL_INTAKE_BROAD_FILTER_THRESHOLD's default: 20 emails a day.
  for (let n = 0; n < 20; n++) await receivedEmail(candidateId, n % 2 ? "other" : "unrecognised_sender", "newsletter.example");

  await page.goto(`/recherches?profil=${daf}`);

  const notice = page.getByRole("note", { name: "Filtre trop large" });
  await expect(notice).toContainText("20 emails sont arrivés à votre adresse de transfert");
  await expect(notice.getByRole("link", { name: "Revoir le transfert pas à pas" })).toHaveAttribute("href", "/compte/reception-email/assistant");
  await expectNoAxeViolations(page);
});
