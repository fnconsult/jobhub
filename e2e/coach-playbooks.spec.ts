import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #129: the AI Coach's replies are grounded in the Core Digest and 1 or 2 Coaching
// Playbooks. Driven through the public endpoint the Coach Panel uses (POST /api/coach) and the
// Administrator's coach cost page; the AI Coach is faked inside the server (fake-mistral.mjs)
// and, asked with "E2E_SHOW_CONTEXT", replies with the system prompt it was sent. The web
// server serves the unvalidated playbooks (COACH_KNOWLEDGE_ENVIRONMENT=eval, playwright.config.ts).
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
const SHOW = "E2E_SHOW_CONTEXT";
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const tokens = (text: string) => Math.ceil(text.length / 4);

const masterCv = (headline: string) => ({
  fullName: "Marie Dupont",
  email: "marie.dupont@example.fr",
  phone: "06 12 34 56 78",
  location: "12 rue de la République, 69002 Lyon",
  headline,
  summary: "",
  experience: [{ title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2005 – 2024", description: "Pilotage financier." }],
  education: [],
  skills: ["IFRS", "Consolidation"],
  languages: [],
});

async function createProfile(page: Page, targetRole = "Directrice financière"): Promise<string> {
  const created = await page.request.post("/api/profiles", {
    headers: { origin },
    data: { masterCv: masterCv(targetRole), searchCriteria: { targetRole, location: "Lyon", contractType: "cdi" } },
  });
  expect(created.status(), await created.text()).toBe(201);
  return (await created.json()).id;
}

async function captureOffer(page: Page, title: string, content = "Vos missions : piloter la clôture mensuelle."): Promise<string> {
  const captured = await page.request.post("/api/job-offers", {
    headers: { origin },
    data: {
      source: { url: `https://www.apec.fr/offres/${unique()}` },
      title,
      content: `${content} (${unique()})`,
      employer: "Acme Industrie",
      location: "Lyon",
      contractType: "cdi",
      skills: ["IFRS", "Consolidation"],
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

/** The system prompt the AI Coach was sent for this message. */
async function promptFor(page: Page, message: string, focus?: { kind: string; id: string }): Promise<string> {
  const response = await page.request.post("/api/coach", { headers: { origin }, data: { message: `${message} ${SHOW}`, ...(focus ? { focus } : {}) } });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).reply;
}

/** The Core Digest and playbooks the prompt holds, as "id version", in the order they appear. */
function groundingOf(prompt: string): string[] {
  const found = [...prompt.matchAll(/<(?:socle|playbook)(?: id="([^"]+)")? version="([^"]+)">/g)];
  return found.map(([, id, version]) => `${id ?? "core-digest"} ${version}`);
}
const ids = (prompt: string) => groundingOf(prompt).map((entry) => entry.split(" ")[0]);

test.describe("playbook selection, per row of the playbook table", () => {
  test("Application In view → cover-letter-writing and ats-optimization", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("pb-application"));
    const profileId = await createProfile(page);
    const applicationId = await saveApplication(page, await captureOffer(page, "DAF Playbook"), profileId);
    expect(ids(await promptFor(page, "Que me conseillez-vous ?", { kind: "application", id: applicationId }))).toEqual(["core-digest", "cover-letter-writing", "ats-optimization"]);
  });

  test("Job Offer In view → cv-offer-fit-scoring", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("pb-offer"));
    await createProfile(page);
    const offerId = await captureOffer(page, "DAF Offre Playbook");
    expect(ids(await promptFor(page, "Que me conseillez-vous ?", { kind: "job_offer", id: offerId }))).toEqual(["core-digest", "cv-offer-fit-scoring"]);
  });

  test("Profile In view → senior-40plus-positioning", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("pb-profile"));
    const profileId = await createProfile(page);
    expect(ids(await promptFor(page, "Que me conseillez-vous ?", { kind: "profile", id: profileId }))).toEqual(["core-digest", "senior-40plus-positioning"]);
  });

  const topics = [
    { row: "interview", message: "Comment préparer mon entretien avec le N+1 ?", playbooks: ["interview-journey-stages", "interview-psychology"] },
    { row: "outreach / network", message: "Comment contacter le directeur financier sur LinkedIn ?", playbooks: ["outreach-first-contact", "application-strategy"] },
    { row: "freelance / portage / interim", message: "Le portage salarial, est-ce fait pour moi ?", playbooks: ["freelance-mission-positioning"] },
    { row: "positioning, age, CV", message: "J'ai 56 ans : comment me positionner sans paraître trop âgée ?", playbooks: ["senior-40plus-positioning"] },
    { row: "pace, motivation, budget", message: "Je perds ma motivation et mon budget fond, quel rythme tenir ?", playbooks: ["coaching-journey-gamification"] },
    { row: "no In view and no topic (default)", message: "Bonjour", playbooks: ["senior-40plus-positioning"] },
  ];
  for (const { row, message, playbooks } of topics) {
    test(`topic: ${row} → ${playbooks.join(", ")}`, async ({ page }) => {
      await signInWithMagicLink(page, newAddress("pb-topic"));
      await createProfile(page);
      expect(ids(await promptFor(page, message))).toEqual(["core-digest", ...playbooks]);
    });
  }

  test("the message topic comes before what is In view, and never more than 2 playbooks", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("pb-topic-first"));
    const profileId = await createProfile(page);
    const applicationId = await saveApplication(page, await captureOffer(page, "DAF Entretien"), profileId);
    const prompt = await promptFor(page, "Comment préparer mon entretien ?", { kind: "application", id: applicationId });
    expect(ids(prompt)).toEqual(["core-digest", "interview-journey-stages", "interview-psychology"]);
  });
});

test.describe("the Ground Coach reply prompt", () => {
  test("puts playbooks above general knowledge, bans statistics outside a playbook and carries the playbooks with their Sources", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("pb-prompt"));
    await createProfile(page);
    const prompt = await promptFor(page, "Comment préparer mon entretien ?");
    expect(prompt).toMatch(/priment sur tes connaissances générales/);
    expect(prompt).toMatch(/aucun chiffre ni statistique qui ne figure pas dans le socle ou un playbook/);
    expect(prompt).toMatch(/conseil général, sans chiffre/);
    expect(prompt).toMatch(/<playbook id="interview-psychology" version="[^"]+">\n# /);
    expect(prompt).toMatch(/<sources>\n\[S\d+\] .+, \d{4} : /);
    // The knowledge comes before the Candidate's context.
    expect(prompt.indexOf("<socle")).toBeLessThan(prompt.indexOf("Le candidat s'appelle Marie"));
  });
});

test.describe("the 12k-token cap", () => {
  test("keeps the playbooks and cuts the huge item In view", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("pb-cap"));
    await createProfile(page);
    const huge = await captureOffer(page, "Offre géante playbook", "Mission interminable. ".repeat(4_300));
    const prompt = await promptFor(page, "Que me conseillez-vous ?", { kind: "job_offer", id: huge });
    expect(tokens(prompt)).toBeLessThanOrEqual(12_000);
    expect(prompt).toContain("(la suite est coupée)");
    expect(ids(prompt)).toEqual(["core-digest", "cv-offer-fit-scoring"]);
    expect(prompt).toContain("Le candidat s'appelle Marie");
  });
});

test.describe("playbooks recorded per message", () => {
  const ADMINISTRATOR = "playbook-office@e2e.jobbbox.test";

  async function costRowToday(browser: Browser) {
    const context = await browser.newContext({ baseURL: origin, locale: "en-US" });
    const admin = await context.newPage();
    await signInWithMagicLink(admin, ADMINISTRATOR);
    await admin.goto("/admin/cout-coach");
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
    const row = admin.getByRole("row").filter({ has: admin.locator(`time[datetime="${today}"]`) });
    await expect(row).toHaveCount(1);
    const cells = await row.getByRole("cell").allTextContents();
    await context.close();
    return cells;
  }

  test("an Administrator sees which playbook and Core Digest versions answered today", async ({ page, browser }) => {
    await signInWithMagicLink(page, newAddress("pb-record"));
    await createProfile(page);
    const prompt = await promptFor(page, "Comment préparer mon entretien ?");
    const used = groundingOf(prompt);
    expect(used.map((entry) => entry.split(" ")[0])).toEqual(["core-digest", "interview-journey-stages", "interview-psychology"]);

    const cells = await costRowToday(browser);
    const playbooksCell = cells.at(-1)!;
    expect(fr.admin.coachCost.playbooks).toBe("Playbooks utilisés");
    for (const entry of used) expect(playbooksCell).toMatch(new RegExp(`${entry.replace(".", "\\.")} \\(\\d+\\)`));
  });

  test("the Candidate's reply says nothing of the playbooks used", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("pb-hidden"));
    await createProfile(page);
    const sent = await page.request.post("/api/coach", { headers: { origin }, data: { message: "Comment préparer mon entretien ?" } });
    expect(sent.status()).toBe(200);
    expect(JSON.stringify(await sent.json())).not.toMatch(/playbook|core-digest/i);
  });
});
