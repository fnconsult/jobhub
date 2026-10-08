import { expect, request as playwrightRequest, test, type APIRequestContext } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { e2eExtensionDir, unpackedExtensionId } from "./support/extension";
import { newAddress } from "./support/mailbox";

// Issue #9: a Job Offer is captured over HTTP (shared, deduplicated by source
// URL and content) and a CV, Master or Tailored, gets a Match Score against
// it, with a breakdown against the Search Criteria. A Guest, without an
// account, can do both: the extension's Guest flow needs it.
const origin = process.env.E2E_WEB_ORIGIN!;
const extensionOrigin = `chrome-extension://${unpackedExtensionId(e2eExtensionDir)}`;

/** Each test captures its own postings: Job Offers are deduplicated across the whole run. */
const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function dafOffer(tag: string) {
  return {
    source: { url: `https://www.welcometothejungle.com/fr/jobs/daf-acme-${tag}?utm_source=linkedin&utm_medium=social` },
    title: "Directeur administratif et financier (H/F)",
    content: `Acme Industrie recrute son DAF (réf. ${tag}).\n\nVous justifiez de 15 ans d'expérience en direction financière.\nPoste basé à Lyon, CDI.`,
    employer: "Acme Industrie",
    location: "Lyon",
    contractType: "cdi",
    salary: { min: 100_000, max: 120_000 },
    skills: ["IFRS", "Consolidation", "SAP", "Power BI"],
  };
}

/** A Master CV with 19 years of dated experience (2005 – 2024) and three of the four skills the DAF offer asks for. */
const masterCv = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "06 12 34 56 78",
  location: "Lyon",
  summary: "Directrice financière dans l'industrie.",
  experience: [
    { title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2015 – 2024", description: "Pilotage financier d'un groupe." },
    { title: "Responsable du contrôle de gestion", employer: "Renault", location: "Paris", period: "2005 – 2015", description: "Reporting mensuel." },
  ],
  education: [{ degree: "Master Finance", institution: "ESSEC", year: "1998" }],
  skills: ["Consolidation", "IFRS", "SAP", "Management d'équipe"],
  languages: [{ name: "Anglais", level: "courant" }],
};

/** The Master CV adapted to the DAF offer: it now shows Power BI too. */
const tailoredCv = { ...masterCv, skills: [...masterCv.skills, "Power BI"] };

const searchCriteria = { targetRole: "Directrice administrative et financière", location: "Lyon", minSalary: 110_000, contractType: "cdi" };

/** A browser or extension with no account: no cookies at all. */
async function guestFrom(requestOrigin: string): Promise<APIRequestContext> {
  return playwrightRequest.newContext({ baseURL: origin, extraHTTPHeaders: { origin: requestOrigin } });
}

async function capture(api: APIRequestContext, offer: object, headers: Record<string, string> = {}) {
  const response = await api.post("/api/job-offers", { data: offer, headers });
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

async function matchScore(api: APIRequestContext, body: object, headers: Record<string, string> = {}) {
  const response = await api.post("/api/match-score", { data: body, headers });
  return { status: response.status(), body: await response.json() };
}

test.describe("Job Offers", () => {
  test("a captured Job Offer keeps its source, full content, employer, location, contract type and salary", async () => {
    const guest = await guestFrom(extensionOrigin);
    const tag = unique();
    const offer = dafOffer(tag);
    const captured = await capture(guest, offer);

    expect(captured.id).toMatch(/^[0-9a-f-]{36}$/);
    const stored = await (await guest.get(`/api/job-offers/${captured.id}`)).json();
    expect(stored).toEqual({
      id: captured.id,
      source: { url: offer.source.url, name: "welcometothejungle.com" },
      title: "Directeur administratif et financier (H/F)",
      content: `Acme Industrie recrute son DAF (réf. ${tag}).\n\nVous justifiez de 15 ans d'expérience en direction financière.\nPoste basé à Lyon, CDI.`,
      employer: "Acme Industrie",
      location: "Lyon",
      contractType: "cdi",
      salary: { min: 100_000, max: 120_000 },
      skills: ["IFRS", "Consolidation", "SAP", "Power BI"],
    });
    await guest.dispose();
  });

  test("what the posting does not state is left out, and a named source keeps its name", async () => {
    const guest = await guestFrom(origin);
    const content = `Cabinet recherche un comptable (réf. ${unique()}).`;
    const captured = await capture(guest, { source: { name: "Bouche-à-oreille" }, title: "Comptable", content });

    const stored = await (await guest.get(`/api/job-offers/${captured.id}`)).json();
    expect(stored).toEqual({ id: captured.id, source: { name: "Bouche-à-oreille" }, title: "Comptable", content });
    await guest.dispose();
  });

  test("the same posting captured twice is one Job Offer: by its URL without tracking, or by its text", async () => {
    const guest = await guestFrom(origin);
    const tag = unique();
    const first = await capture(guest, dafOffer(tag));
    const sameUrl = await capture(guest, {
      ...dafOffer(tag),
      source: { url: `https://welcometothejungle.com/fr/jobs/daf-acme-${tag}/?utm_campaign=other#apply` },
      content: "Texte remanié par le site.",
    });
    expect(sameUrl.id).toBe(first.id);

    const text = `Poste de trésorier à Lille (réf. ${tag}).`;
    const onOneSite = await capture(guest, { source: { url: `https://www.apec.fr/offre/${tag}` }, title: "Trésorier", content: text });
    const onAnother = await capture(guest, { source: { url: `https://fr.indeed.com/job/${tag}` }, title: "Trésorier", content: `  POSTE de trésorier   à Lille (réf. ${tag}).` });
    expect(onAnother.id).toBe(onOneSite.id);
    expect(onAnother.source.url).toBe(`https://www.apec.fr/offre/${tag}`);
    await guest.dispose();
  });

  test("a posting without title or content, or with an unknown contract type, is refused with the fields to fix", async () => {
    const guest = await guestFrom(origin);
    const response = await guest.post("/api/job-offers", { data: { title: " ", content: "x", contractType: "stage" } });
    expect(response.status()).toBe(400);
    expect((await response.json()).errors).toEqual(
      expect.arrayContaining([
        { field: "title", code: "required" },
        { field: "contractType", code: "invalid" },
      ]),
    );
    expect((await guest.get("/api/job-offers/00000000-0000-4000-8000-000000000000")).status()).toBe(404);
    await guest.dispose();
  });

  test("a site that is not the app or the extension cannot capture", async () => {
    const other = await guestFrom("https://evil.example");
    const response = await other.post("/api/job-offers", { data: dafOffer(unique()) });
    expect(response.status()).toBe(403);
    await other.dispose();
  });
});

test.describe("Match Score", () => {
  test("a Guest, from the extension and without an account, gets a Match Score for their CV and Search Criteria", async () => {
    const guest = await guestFrom(extensionOrigin);
    const offer = await capture(guest, dafOffer(unique()));

    // Search Criteria wanting more money and a freelance contract.
    const criteria = { targetRole: "DAF", location: "Lyon", minSalary: 130_000, contractType: "freelance" };
    const { status, body } = await matchScore(guest, { jobOfferId: offer.id, cv: masterCv, searchCriteria: criteria });

    expect(status).toBe(200);
    // Skills 3/4 of 40 = 30, seniority 20, location 15, salary partial (120k within 10% of 130k) 5, contract 0.
    expect(body).toEqual({
      score: 70,
      breakdown: {
        skills: { status: "partial", covered: ["IFRS", "Consolidation", "SAP"], missing: ["Power BI"] },
        seniority: { status: "match", cvYears: 19, requiredYears: 15 },
        location: { status: "match", offer: "Lyon", wanted: "Lyon" },
        salary: { status: "partial", offer: { min: 100_000, max: 120_000 }, wanted: 130_000 },
        contractType: { status: "mismatch", offer: "cdi", wanted: "freelance" },
      },
    });
    await guest.dispose();
  });

  test("a Guest without Search Criteria is scored on the CV's own location; the unknown criteria do not count", async () => {
    const guest = await guestFrom(extensionOrigin);
    const offer = await capture(guest, dafOffer(unique()));
    const { status, body } = await matchScore(guest, { jobOfferId: offer.id, cv: { ...masterCv, location: "Paris" } });

    expect(status).toBe(200);
    // Known: skills 30/40, seniority 20/20, location 0/15 → 50 of 75.
    expect(body.score).toBe(67);
    expect(body.breakdown.location).toEqual({ status: "mismatch", offer: "Lyon", wanted: "Paris" });
    expect(body.breakdown.salary).toEqual({ status: "unknown", offer: { min: 100_000, max: 120_000 } });
    expect(body.breakdown.contractType).toEqual({ status: "unknown", offer: "cdi" });
    await guest.dispose();
  });

  test("a signed-in Candidate gets the Match Score of a Profile's Master CV, against that Profile's Search Criteria", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("match-master"));
    const saved = await page.request.post("/api/profiles", { data: { masterCv, searchCriteria }, headers: { origin } });
    expect(saved.status(), await saved.text()).toBe(201);
    const { id: profileId } = await saved.json();
    const offer = await capture(page.request, dafOffer(unique()), { origin });

    const { status, body } = await matchScore(page.request, { jobOfferId: offer.id, profileId }, { origin });
    expect(status).toBe(200);
    // Skills 30/40, seniority 20, location 15, salary 10, contract 15.
    expect(body).toEqual({
      score: 90,
      breakdown: {
        skills: { status: "partial", covered: ["IFRS", "Consolidation", "SAP"], missing: ["Power BI"] },
        seniority: { status: "match", cvYears: 19, requiredYears: 15 },
        location: { status: "match", offer: "Lyon", wanted: "Lyon" },
        salary: { status: "match", offer: { min: 100_000, max: 120_000 }, wanted: 110_000 },
        contractType: { status: "match", offer: "cdi", wanted: "cdi" },
      },
    });

    // A Tailored CV, adapted to this Job Offer, is sent with the request and scores higher.
    const tailored = await matchScore(page.request, { jobOfferId: offer.id, cv: tailoredCv, searchCriteria }, { origin });
    expect(tailored.status).toBe(200);
    expect(tailored.body.score).toBe(100);
    expect(tailored.body.breakdown.skills).toEqual({ status: "match", covered: ["IFRS", "Consolidation", "SAP", "Power BI"], missing: [] });
  });

  test("a Profile's Master CV is scored only for its own Candidate", async ({ page, browser }) => {
    await signInWithMagicLink(page, newAddress("match-owner"));
    const saved = await page.request.post("/api/profiles", { data: { masterCv, searchCriteria }, headers: { origin } });
    const { id: profileId } = await saved.json();
    const offer = await capture(page.request, dafOffer(unique()), { origin });

    const guest = await guestFrom(extensionOrigin);
    expect(await matchScore(guest, { jobOfferId: offer.id, profileId })).toEqual({ status: 401, body: { error: "unauthorized" } });
    await guest.dispose();

    const otherContext = await browser.newContext({ baseURL: origin });
    const other = await otherContext.newPage();
    await signInWithMagicLink(other, newAddress("match-other"));
    expect(await matchScore(other.request, { jobOfferId: offer.id, profileId }, { origin })).toEqual({ status: 404, body: { error: "not_found" } });
    await otherContext.close();
  });

  test("an unknown Job Offer, a malformed request or an untrusted site gets no Match Score", async () => {
    const guest = await guestFrom(extensionOrigin);
    const missing = await matchScore(guest, { jobOfferId: "00000000-0000-4000-8000-000000000000", cv: masterCv });
    expect(missing).toEqual({ status: 404, body: { error: "not_found" } });

    const malformed = await matchScore(guest, { jobOfferId: "", cv: { fullName: "Marie" } });
    expect(malformed.status).toBe(400);
    expect(malformed.body.error).toBe("invalid");
    expect(malformed.body.errors).toEqual(expect.arrayContaining([{ field: "jobOfferId", code: "required" }]));
    await guest.dispose();

    const app = await guestFrom(origin);
    const offer = await capture(app, dafOffer(unique()));
    await app.dispose();
    const other = await guestFrom("https://evil.example");
    expect((await matchScore(other, { jobOfferId: offer.id, cv: masterCv })).status).toBe(403);
    await other.dispose();
  });
});
