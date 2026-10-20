import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { createJobSearchReports } from "../apps/web/src/job-searches";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { subscribe } from "./support/plan";
import { showSystemPrompt, systemPromptShown } from "./support/system-prompt";

// Issue #126: what the AI Coach is told of the Candidate before each reply.
// Driven through the public endpoint the Coach Panel uses (POST /api/coach); the
// AI Coach is faked inside the server (fake-mistral.mjs) and, asked with
// "E2E_SHOW_CONTEXT#<tag>", prints the system prompt it was sent, which holds the
// Coach's context, to the server log (support/system-prompt.ts). The Coach Memory (#125) has no way in yet: it is covered by
// the Coach's unit tests, and here only its absence is checked.
const origin = process.env.E2E_WEB_ORIGIN!;
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const IDENTITY = {
  fullName: "Marie Dupont",
  email: "marie.dupont@example.fr",
  phone: "06 12 34 56 78",
  location: "12 rue de la République, 69002 Lyon",
};

const SKILLS = ["IFRS", "Consolidation", "SAP", "Budget", "Trésorerie", "Audit"];

const masterCv = (headline: string, extra: Record<string, unknown> = {}) => ({
  ...IDENTITY,
  headline,
  summary: "",
  experience: [{ title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2005 – 2024", description: "Pilotage financier." }],
  education: [],
  skills: SKILLS,
  languages: [],
  ...extra,
});

async function createProfile(page: Page, targetRole: string, cvExtra: Record<string, unknown> = {}): Promise<string> {
  const created = await page.request.post("/api/profiles", {
    headers: { origin },
    data: { masterCv: masterCv(targetRole, cvExtra), searchCriteria: { targetRole, locations: ["Lyon"], contractTypes: ["cdi"] } },
  });
  expect(created.status(), await created.text()).toBe(201);
  return (await created.json()).id;
}

async function captureOffer(page: Page, title: string, skills: string[], content = "Vos missions : piloter la clôture mensuelle."): Promise<string> {
  const captured = await page.request.post("/api/job-offers", {
    headers: { origin },
    data: {
      source: { url: `https://www.apec.fr/offres/${unique()}` },
      title,
      content: `${content} (${unique()})`,
      employer: "Acme Industrie",
      location: "Lyon",
      contractType: "cdi",
      skills,
      requiredExperienceYears: 10,
    },
  });
  expect(captured.status(), await captured.text()).toBe(200);
  return (await captured.json()).id;
}

async function saveApplication(page: Page, jobOfferId: string, profileId: string): Promise<string> {
  const saved = await page.request.post("/api/applications", { headers: { origin }, data: { jobOfferId, profileId } });
  expect(saved.ok(), await saved.text()).toBe(true);
  return (await saved.json()).id;
}

async function candidateId(page: Page): Promise<string> {
  return (await (await page.request.get("/api/auth/get-session")).json()).user.id;
}

/**
 * What the worker's Job Search and Job Digest runs leave behind (no public endpoint stores results without a worker).
 * A Job Search is finished the way the worker finishes it, through its report (createJobSearchReports), so the row
 * carries metrics like every finished Job Search: the database is shared with e2e/job-search-metrics.spec.ts.
 */
async function storeResults(kind: "job_search" | "job_digest", candidate: string, profileId: string, jobOfferIds: string[]): Promise<string> {
  const db = new pg.Pool({ connectionString: process.env.E2E_DATABASE_URL });
  try {
    if (kind === "job_digest") {
      const { rows } = await db.query("INSERT INTO job_digest (candidate_id, profile_id, job_offer_ids, sent_at) VALUES ($1, $2, $3, now()) RETURNING id", [candidate, profileId, jobOfferIds]);
      return rows[0].id;
    }
    const { rows } = await db.query("INSERT INTO job_search (candidate_id, profile_id, status, started_at) VALUES ($1, $2, 'searching', now()) RETURNING id", [candidate, profileId]);
    const id: string = rows[0].id;
    await createJobSearchReports(db, { quotas: { release: async () => {} } }).record(id, { jobOfferIds });
    return id;
  } finally {
    await db.end();
  }
}

/** The day `offset` days from now, in French time ("2026-10-30"). */
const parisDay = (offset: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(Date.now() + offset * 86_400_000));

/** An Application at "Entretien" on a Job Offer `title`, with an Interview at each of `times` (French time, "2026-10-30T14:30"). */
async function interviewsFor(page: Page, profileId: string, title: string, times: string[], note = ""): Promise<void> {
  const applicationId = await saveApplication(page, await captureOffer(page, title, SKILLS), profileId);
  const moved = await page.request.patch(`/api/applications/${applicationId}`, { headers: { origin }, data: { status: "interview" } });
  expect(moved.ok(), await moved.text()).toBe(true);
  for (const scheduledAt of times) {
    const added = await page.request.post(`/api/applications/${applicationId}/interviews`, { headers: { origin }, data: { scheduledAt, ...(note ? { note } : {}) } });
    expect(added.ok(), await added.text()).toBe(true);
  }
}

/** The context the AI Coach was sent along with the Candidate's message. */
async function contextOf(page: Page, focus?: { kind: string; id: string }): Promise<string> {
  const show = showSystemPrompt();
  const response = await page.request.post("/api/coach", { headers: { origin }, data: { message: `Bonjour ${show}`, ...(focus ? { focus } : {}) } });
  expect(response.status(), await response.text()).toBe(200);
  return systemPromptShown(show);
}

const tokens = (text: string) => Math.ceil(text.length / 4);

test.describe("what the AI Coach is told", () => {
  test("always includes a short Candidate summary: first name, target role, Search Criteria and seniority; and no Coach Memory when there is none", async ({ page }) => {
    const email = newAddress("ctx-summary");
    await signInWithMagicLink(page, email);
    await createProfile(page, "Directrice financière");

    const context = await contextOf(page);

    expect(context).toContain("Le candidat s'appelle Marie (prénom seulement).");
    expect(context).toContain("poste visé Directrice financière");
    expect(context).toContain("lieu Lyon");
    expect(context).toContain("contrat CDI");
    expect(context).toMatch(/séniorité : \d+ ans d'expérience/);
    expect(context).toContain("Le candidat ne consulte aucun élément en particulier");
    expect(context).not.toMatch(/mémoire du coach/i);
  });

  test("puts the Profile in view in full: Search Criteria and the Master CV", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("ctx-profile"));
    const profileId = await createProfile(page, "Directrice financière", { summary: "Vingt ans de finance industrielle." });

    const context = await contextOf(page, { kind: "profile", id: profileId });

    expect(context).toContain("Le candidat consulte son profil « Directrice financière ».");
    expect(context).toContain("Critères de recherche : poste visé Directrice financière");
    expect(context).toContain("Groupe Seb");
    expect(context).toContain("Vingt ans de finance industrielle.");
    expect(context).toContain("Compétences : IFRS, Consolidation");
  });

  test("puts the Application in view in full: status, Match Score and the whole Job Offer", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("ctx-application"));
    const profileId = await createProfile(page, "Directrice financière");
    const offerId = await captureOffer(page, "DAF Application", SKILLS, "Vos missions : piloter la clôture mensuelle, encadrer douze personnes.");
    const applicationId = await saveApplication(page, offerId, profileId);
    const moved = await page.request.patch(`/api/applications/${applicationId}`, { headers: { origin }, data: { status: "interview" } });
    expect(moved.ok(), await moved.text()).toBe(true);

    const context = await contextOf(page, { kind: "application", id: applicationId });

    expect(context).toContain("Le candidat consulte sa candidature avec le profil « Directrice financière ».");
    expect(context).toContain("Statut : Entretien");
    expect(context).toMatch(/Score de correspondance : \d+\/100/);
    expect(context).toContain("DAF Application chez Acme Industrie");
    expect(context).toContain("piloter la clôture mensuelle, encadrer douze personnes.");
  });

  test("puts the Job Offer in view in full: the whole posting", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("ctx-offer"));
    const profileId = await createProfile(page, "Directrice financière");
    const offerId = await captureOffer(page, "DAF Offre", SKILLS, "Vos missions : piloter la trésorerie du groupe.");

    const context = await contextOf(page, { kind: "job_offer", id: offerId });

    expect(context).toContain("Le candidat consulte une offre d'emploi.");
    expect(context).toContain("DAF Offre chez Acme Industrie (Lyon)");
    expect(context).toContain("Compétences demandées : " + SKILLS.join(", "));
    expect(context).toContain("piloter la trésorerie du groupe.");
    expect(profileId).toBeTruthy();
  });

  test("puts the Job Search in view in full: its Profile and every Job Offer found with its Match Score", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("ctx-search"));
    const profileId = await createProfile(page, "Directrice financière");
    const found = [await captureOffer(page, "Trouvée A", SKILLS), await captureOffer(page, "Trouvée B", ["Cuisine"])];
    const searchId = await storeResults("job_search", await candidateId(page), profileId, found);

    const context = await contextOf(page, { kind: "job_search", id: searchId });

    expect(context).toContain("Le candidat consulte une recherche d'offres");
    expect(context).toContain("pour son profil « Directrice financière » (terminée)");
    expect(context).toMatch(/- Trouvée A chez Acme Industrie \(Lyon\) : score \d+\/100/);
    expect(context).toMatch(/- Trouvée B chez Acme Industrie \(Lyon\) : score \d+\/100/);
    expect(context.indexOf("Trouvée A")).toBeLessThan(context.indexOf("Trouvée B"));
  });

  test("puts the Job Digest in view in full: its Profile and every Job Offer in it with its Match Score", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("ctx-digest"));
    const profileId = await createProfile(page, "Directrice financière");
    const sent = [await captureOffer(page, "Sélection A", SKILLS), await captureOffer(page, "Sélection B", ["Cuisine"])];
    const digestId = await storeResults("job_digest", await candidateId(page), profileId, sent);

    const context = await contextOf(page, { kind: "job_digest", id: digestId });

    expect(context).toContain("Le candidat consulte la sélection d'offres envoyée le");
    expect(context).toContain("pour son profil « Directrice financière »");
    expect(context).toMatch(/- Sélection A chez Acme Industrie \(Lyon\) : score \d+\/100/);
    expect(context).toMatch(/- Sélection B chez Acme Industrie \(Lyon\) : score \d+\/100/);
  });

  test("puts the Agenda in view (#254): the Candidate's own Agenda Items of the next 30 days, with their notes", async ({ page, browser }) => {
    const other = await browser.newPage();
    await signInWithMagicLink(other, newAddress("ctx-agenda-other"));
    await interviewsFor(other, await createProfile(other, "Contrôleur de gestion"), "Poste d'un autre", [`${parisDay(3)}T09:00`]);
    await other.close();
    await signInWithMagicLink(page, newAddress("ctx-agenda"));
    const profileId = await createProfile(page, "Directrice financière");
    await interviewsFor(page, profileId, "DAF Agenda", [`${parisDay(2)}T14:30`], "avec la DRH");
    await interviewsFor(page, profileId, "DAF Trop tard", [`${parisDay(40)}T10:00`]);

    const context = await contextOf(page, { kind: "agenda", id: "agenda" });

    expect(context).toContain("Le candidat consulte son agenda « Entretiens et rendez-vous ».");
    expect(context).toMatch(/- \S+ \d+ \S+ \d{4} à 14:30 : entretien pour DAF Agenda chez Acme Industrie ; note : avec la DRH/);
    expect(context).not.toContain("DAF Trop tard");
    expect(context).not.toContain("Poste d'un autre");
  });

  test("summarises the next three Agenda Items on any page (#254)", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("ctx-agenda-next"));
    const profileId = await createProfile(page, "Directrice financière");
    await interviewsFor(page, profileId, "Prochain", [1, 2, 3, 4].map((day) => `${parisDay(day)}T10:00`));

    const context = await contextOf(page);

    expect(context).toContain("Ses 3 prochains entretiens et rendez-vous (heure de Paris) :");
    expect(context.match(/: entretien pour Prochain chez Acme Industrie/g)).toHaveLength(3);
  });

  test("summarises the 5 latest Applications with their status, the top 5 Job Offers by Match Score, and the onboarding answers", async ({ page }) => {
    const email = newAddress("ctx-summaries");
    await signInWithMagicLink(page, email);
    await subscribe(page, email, "standard");
    const profileId = await createProfile(page, "Directrice financière");
    await createProfile(page, "Consultante transformation", { summary: "Je veux accompagner des PME dans leur transformation." });

    // Seven Applications, oldest first; the first two fall outside the 5 latest.
    for (let n = 1; n <= 7; n++) {
      const applicationId = await saveApplication(page, await captureOffer(page, `Candidature n°${n}`, ["Cuisine"]), profileId);
      if (n === 7) {
        const moved = await page.request.patch(`/api/applications/${applicationId}`, { headers: { origin }, data: { status: "applied" } });
        expect(moved.ok(), await moved.text()).toBe(true);
      }
    }
    // Seven Job Offers found, covering 6 down to 0 of the Profile's skills: the best 5 are summarised.
    const found: string[] = [];
    for (let covered = 6; covered >= 0; covered--) {
      found.push(await captureOffer(page, `Match ${covered} sur 6`, [...SKILLS.slice(0, covered), "Cuisine"]));
    }
    await storeResults("job_search", await candidateId(page), profileId, found);

    const context = await contextOf(page);

    for (const n of [3, 4, 5, 6]) expect(context).toMatch(new RegExp(`Candidature n°${n} chez Acme Industrie \\(Lyon\\) : À postuler depuis le \\d{4}-\\d\\d-\\d\\d \\(profil « Directrice financière »\\)`));
    expect(context).toMatch(/Candidature n°7 chez Acme Industrie \(Lyon\) : Postulée depuis le/);
    expect(context).not.toContain("Candidature n°1 ");
    expect(context).not.toContain("Candidature n°2 ");

    const section = context.slice(context.indexOf("offres d'emploi qui lui correspondent le mieux"));
    const order = [6, 5, 4, 3, 2].map((covered) => section.indexOf(`Match ${covered} sur 6`));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(context).not.toContain("Match 1 sur 6");
    expect(context).not.toContain("Match 0 sur 6");

    expect(context).toContain("réponses d'onboarding");
    expect(context).toContain("« Consultante transformation » ; Consultante transformation ; Je veux accompagner des PME dans leur transformation.");
  });

  test("stays within about 12k tokens, trimming the summaries first and keeping the Candidate summary", async ({ page }) => {
    const email = newAddress("ctx-cap");
    await signInWithMagicLink(page, email);
    const profileId = await createProfile(page, "Directrice financière");
    for (let n = 1; n <= 3; n++) await saveApplication(page, await captureOffer(page, `Candidature trimée ${n}`, ["Cuisine"]), profileId);

    // With a modest In-view item, the summaries are there and the context is well under the cap.
    const small = await captureOffer(page, "Petite offre", SKILLS);
    const roomy = await contextOf(page, { kind: "job_offer", id: small });
    expect(roomy).toContain("Candidature trimée 3");
    expect(tokens(roomy)).toBeLessThan(12_000);

    // A 100 000-character posting in view alone would be some 25k tokens.
    const huge = await captureOffer(page, "Offre géante", SKILLS, "Mission interminable. ".repeat(4_300));
    const capped = await contextOf(page, { kind: "job_offer", id: huge });

    expect(tokens(capped)).toBeLessThanOrEqual(12_000);
    expect(tokens(capped)).toBeGreaterThan(11_000);
    // Summaries went first; the Candidate summary and the start of the item in view stayed.
    expect(capped).not.toContain("Candidature trimée");
    expect(capped).toContain("Le candidat s'appelle Marie (prénom seulement).");
    expect(capped).toContain("poste visé Directrice financière");
    expect(capped).toContain("Offre : Offre géante chez Acme Industrie");
    expect(capped).toContain("(la suite est coupée)");
  });

  test("tells the AI Coach the first name only: the Master CV's full name, email, phone and address never leave", async ({ page }) => {
    const email = newAddress("ctx-identity");
    await signInWithMagicLink(page, email);
    await subscribe(page, email, "standard");
    // The CV also writes its identity elsewhere: in the summary, a job description, and (for the summary lines) a second Profile.
    const leaky = {
      summary: `Marie Dupont, joignable à marie.dupont@example.fr ou au 06 12 34 56 78, vit au 12 rue de la République, 69002 Lyon.`,
      experience: [
        {
          title: "Directrice financière",
          employer: "Groupe Seb",
          location: "Lyon",
          period: "2005 – 2024",
          description: "Références : Marie Dupont, marie.dupont@example.fr, 06 12 34 56 78.",
        },
      ],
    };
    const inView = await createProfile(page, "Directrice financière", leaky);
    await createProfile(page, "Consultante transformation", leaky);

    const identityValues = [IDENTITY.fullName, "Dupont", IDENTITY.email, IDENTITY.phone, "12 rue de la République", "69002"];
    for (const focus of [{ kind: "profile", id: inView }, undefined]) {
      const context = await contextOf(page, focus);
      expect(context).toContain("Marie");
      for (const value of identityValues) expect(context, `${value} (${focus?.kind ?? "no focus"})`).not.toContain(value);
    }
  });
});
