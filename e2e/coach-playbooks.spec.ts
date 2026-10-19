import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issues #129 and #225: the AI Coach's replies draw on the Core Digest and on the advice of at most
// two Playbook Agents it chose to consult. Driven through the public endpoint the Coach Panel uses
// (POST /api/coach) and the Administrator's coach cost page; Mistral is faked inside the server
// (fake-mistral.mjs): asked which Playbook Agents to consult, it names those the message lists after
// "E2E_CONSULT=", each Playbook Agent answers with advice naming its playbook and version, and the
// AI Coach, asked with "E2E_SHOW_CONTEXT", replies with the system prompt it was sent. The e2e server
// serves the imported, unvalidated Playbook Versions (JOBHUB_TARGET=e2e, playwright.config.ts).
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

/** The system prompt the AI Coach was sent for this message. */
async function promptFor(page: Page, message: string, focus?: { kind: string; id: string }): Promise<string> {
  const response = await page.request.post("/api/coach", { headers: { origin }, data: { message: `${message} ${SHOW}`, ...(focus ? { focus } : {}) } });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).reply;
}

/** The Core Digest and the Playbook Agents' advice the prompt holds, as "id version", in the order they appear. */
function groundingOf(prompt: string): string[] {
  const found = [...prompt.matchAll(/<(?:socle|avis-playbook)(?: id="([^"]+)")? version="([^"]+)">/g)];
  return found.map(([, id, version]) => `${id ?? "core-digest"} ${version}`);
}
const ids = (prompt: string) => groundingOf(prompt).map((entry) => entry.split(" ")[0]);
const consult = (...playbooks: string[]) => `E2E_CONSULT=${playbooks.join(",")}`;

test.describe("Playbook Agents consulted for a reply", () => {
  test("the AI Coach consults at most two of those it chose, each on its own model and effort, and writes the reply with their advice and Sources", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("pb-agents"));
    await createProfile(page);

    const prompt = await promptFor(page, `Comment préparer mon entretien ? ${consult("interview-journey-stages", "interview-psychology", "ats-optimization")}`);

    expect(ids(prompt)).toEqual(["core-digest", "interview-journey-stages", "interview-psychology"]);
    expect(prompt).toMatch(/<avis-playbook id="interview-psychology" version="1">\nAvis du Playbook Agent interview-psychology \(version 1, modèle [^,]+, effort [a-z]+\)/);
    expect(prompt).toMatch(/<sources>\n\[S\d+\] .+, \d{4} : /);
    expect(prompt).toContain("[S24] ");
    // The advice, never the playbooks themselves.
    expect(prompt).not.toMatch(/<playbook id=/);
  });

  test("none chosen: the reply draws on the Core Digest alone", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("pb-none"));
    await createProfile(page);

    expect(ids(await promptFor(page, "Bonjour"))).toEqual(["core-digest"]);
  });

  test("an id that is no Coaching Playbook is ignored", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("pb-unknown"));
    await createProfile(page);

    expect(ids(await promptFor(page, `Mon salaire ? ${consult("salary-negotiation", "interview-psychology")}`))).toEqual(["core-digest", "interview-psychology"]);
  });

  test("a Playbook Agent that fails is left out of the reply, which still comes", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("pb-down"));
    await createProfile(page);

    const prompt = await promptFor(page, `Mon entretien ? ${consult("interview-journey-stages", "interview-psychology")} E2E_AGENT_DOWN=interview-psychology`);

    expect(ids(prompt)).toEqual(["core-digest", "interview-journey-stages"]);
  });
});

test.describe("the Ground Coach reply prompt", () => {
  test("puts the knowledge above general knowledge, bans statistics outside it and comes before the Candidate's context", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("pb-prompt"));
    await createProfile(page);
    const prompt = await promptFor(page, `Comment préparer mon entretien ? ${consult("interview-psychology")}`);
    expect(prompt).toMatch(/priment sur tes connaissances générales/);
    expect(prompt).toMatch(/aucun chiffre ni statistique qui ne figure pas dans le socle ou un avis/);
    expect(prompt).toMatch(/conseil général, sans chiffre/);
    expect(prompt).toMatch(/<socle version="1">\n# Socle de coaching/);
    expect(prompt.indexOf("<socle")).toBeLessThan(prompt.indexOf("Le candidat s'appelle Marie"));
    expect(prompt.indexOf("<avis-playbook")).toBeLessThan(prompt.indexOf("Le candidat s'appelle Marie"));
  });
});

test.describe("the 12k-token cap", () => {
  test("keeps the advice and cuts the huge item In view", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("pb-cap"));
    await createProfile(page);
    const huge = await captureOffer(page, "Offre géante playbook", "Mission interminable. ".repeat(4_300));
    const prompt = await promptFor(page, `Que me conseillez-vous ? ${consult("cv-offer-fit-scoring")}`, { kind: "job_offer", id: huge });
    expect(tokens(prompt)).toBeLessThanOrEqual(12_000);
    expect(prompt).toContain("(la suite est coupée)");
    expect(ids(prompt)).toEqual(["core-digest", "cv-offer-fit-scoring"]);
    expect(prompt).toContain("Le candidat s'appelle Marie");
  });
});

test.describe("playbooks recorded per message", () => {
  const ADMINISTRATOR = "playbook-office@e2e.jobbbox.test";

  async function costPage(browser: Browser) {
    const context = await browser.newContext({ baseURL: origin, locale: "en-US" });
    const admin = await context.newPage();
    await signInWithMagicLink(admin, ADMINISTRATOR);
    await admin.goto("/admin/cout-coach");
    return { admin, close: () => context.close() };
  }

  test("an Administrator sees which Core Digest and Playbook Versions answered today, and the median cost per Playbook Agent", async ({ page, browser }) => {
    await signInWithMagicLink(page, newAddress("pb-record"));
    await createProfile(page);
    const prompt = await promptFor(page, `Comment préparer mon entretien ? ${consult("interview-journey-stages", "interview-psychology")}`);
    const used = groundingOf(prompt);
    expect(used.map((entry) => entry.split(" ")[0])).toEqual(["core-digest", "interview-journey-stages", "interview-psychology"]);

    const { admin, close } = await costPage(browser);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
    const row = admin.getByRole("row").filter({ has: admin.locator(`time[datetime="${today}"]`) });
    await expect(row).toHaveCount(1);
    const playbooksCell = (await row.getByRole("cell").allTextContents()).at(-1)!;
    expect(fr.admin.coachCost.playbooks).toBe("Playbooks utilisés");
    for (const entry of used) expect(playbooksCell).toMatch(new RegExp(`${entry.replace(".", "\\.")} \\(\\d+\\)`));

    const agents = admin.locator('section[aria-labelledby="agents-title"]');
    await expect(agents.getByRole("row").filter({ hasText: "interview-psychology" }).getByRole("cell").first()).toHaveText(/^\d+$/);
    await close();
  });

  test("the Candidate's reply says nothing of the playbooks used", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("pb-hidden"));
    await createProfile(page);
    const sent = await page.request.post("/api/coach", { headers: { origin }, data: { message: `Comment préparer mon entretien ? ${consult("interview-psychology")}` } });
    expect(sent.status()).toBe(200);
    expect(JSON.stringify(await sent.json())).not.toMatch(/playbook|core-digest|avis/i);
  });
});
