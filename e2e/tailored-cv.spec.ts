import { readFileSync, statSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { renderedTexts } from "./support/accessibility";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #18: the AI Coach proposes a Tailored CV for an Application, derived from
// the Profile's Master CV. It only rephrases, reorders, cuts and emphasises the
// Master CV's facts (ADR-0006): the Job Offer's requirements the Master CV lacks
// become questions, added only if the Candidate confirms them. The Candidate
// reviews the changes against the Master CV, with the Match Score of both,
// before saving it on the Application. Written in the Document Language.
// The AI Coach is Mistral, faked by e2e/support/fake-mistral.mjs: it tries to
// slip in "Power BI" and an invented figure, which must not reach the CV.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const tc = fr.tailoredCv;
const origin = process.env.E2E_WEB_ORIGIN!;

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const masterCv = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [
    { title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2005 – 2024", description: "Consolidation IFRS." },
    { title: "Contrôleuse de gestion", employer: "Danone", location: "Paris", period: "1995 – 2005", description: "Reporting mensuel." },
  ],
  education: [{ degree: "Master Finance", institution: "ESSEC", year: "1994" }],
  skills: ["Consolidation", "IFRS", "SAP"],
  languages: [{ name: "Anglais", level: "courant" }],
};

const FRENCH = {
  title: "Directeur administratif et financier (H/F)",
  content: "Acme Industrie recrute son DAF. Vous pilotez la consolidation IFRS sous SAP et le reporting sous Power BI.",
  skills: ["IFRS", "SAP", "Power BI"],
};
const ENGLISH = {
  title: "Chief Financial Officer",
  content: "Globex is looking for a CFO who will lead the finance team. You have 15 years of experience with IFRS and SAP.",
  skills: ["IFRS", "SAP"],
};

/** Signs a new Candidate in and opens a new Application on a Job Offer. */
async function openApplication(page: Page, offer: { title: string; content: string; skills: string[] }, cv = masterCv): Promise<string> {
  await signInWithMagicLink(page, newAddress("tailored-cv"));
  const profile = await page.request.post("/api/profiles", {
    data: { masterCv: cv, searchCriteria: { targetRole: "DAF", location: "Lyon" } },
    headers: { origin },
  });
  expect(profile.status(), await profile.text()).toBe(201);
  const captured = await page.request.post("/api/job-offers", {
    data: { source: { url: `https://www.apec.fr/offres/${unique()}` }, ...offer, employer: "Acme Industrie", location: "Lyon" },
    headers: { origin },
  });
  expect(captured.status(), await captured.text()).toBe(200);
  const saved = await page.request.post("/api/applications", {
    data: { jobOfferId: (await captured.json()).id, profileId: (await profile.json()).id },
    headers: { origin },
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  const id = (await saved.json()).id as string;
  await page.goto(`/candidatures/${id}/documents`);
  await page.waitForLoadState("networkidle");
  return id;
}

// The Tailored CV is the first tab of the Application's Tailored Documents (#136),
// whose Document Language is chosen above the tabs for all of them.
const documents = (page: Page) => page.getByRole("region", { name: fr.application.documentsTitle });
const section = (page: Page) => documents(page).getByRole("tabpanel", { name: tc.tailored, exact: true });
const documentLanguage = (page: Page) => documents(page).getByLabel(fr.tailoredDocuments.languageLabel);
const proposal = (page: Page) => section(page).getByRole("group", { name: tc.proposalTitle });

/** The Master and Tailored Match Scores shown in `scope`, as "62 → 84". */
async function scores(scope: Locator): Promise<{ master: number; tailored: number }> {
  const text = await scope.getByText(/^Score de correspondance : \d+ → \d+$/).textContent();
  const [, master, tailored] = /(\d+) → (\d+)/.exec(text ?? "")!;
  return { master: Number(master), tailored: Number(tailored) };
}

test.describe("Tailored CV with change review", () => {
  test("the Candidate reviews a proposed Tailored CV against the Master CV, answers the coach's questions and saves it on the Application", async ({ page }) => {
    await openApplication(page, FRENCH);
    await expect(section(page).getByText(tc.none)).toBeVisible();
    await expect(documentLanguage(page)).toHaveValue("fr");

    await section(page).getByRole("button", { name: tc.propose }).click();

    await expect(section(page).getByRole("status")).toHaveText(tc.proposed);
    const review = proposal(page);
    await expect(review.getByText(tc.writtenIn.fr)).toBeVisible();
    // The headline is rephrased, shown beside the Master CV's.
    const headline = review.getByRole("listitem").filter({ hasText: `${tc.sections.headline} · ${tc.kinds.rephrased}` });
    await expect(headline.getByText("Directrice financière", { exact: true })).toBeVisible();
    await expect(headline.getByText("Directrice financière (adapté, fr)")).toBeVisible();
    await expect(review.getByText(`${tc.sections.experience} · ${tc.kinds.cut} · Contrôleuse de gestion · Danone · 1995 – 2005`)).toBeVisible();
    // A reorder shows the order before and after.
    const reordered = review.getByRole("listitem").filter({ hasText: `${tc.sections.skills} · ${tc.kinds.reordered}` });
    await expect(reordered.getByRole("definition")).toHaveText(["Consolidation\nIFRS\nSAP", "SAP\nIFRS\nConsolidation"], { useInnerText: true });
    // Wording taken from the Job Offer that the Master CV lacks is kept, but flagged for the Candidate to check (#68).
    const job = review.getByRole("listitem").filter({ hasText: `${tc.sections.experience} · ${tc.kinds.rephrased}` });
    await expect(job.getByRole("note")).toHaveText(tc.fromOffer.replace("{{words}}", "Directeur, administratif"));
    await expect(review.getByText(tc.offerWordingTranslated)).toHaveCount(0);
    // Never invented (ADR-0006): the figure and the keyword the AI Coach slipped in are left out.
    await expect(review.getByText(/20 ans/)).toHaveCount(0);
    await expect(review.getByText(new RegExp(tc.kinds.added.replace(/[()]/g, "\\$&")))).toHaveCount(0);
    const before = await scores(review);
    expect(before.tailored).toBe(before.master);

    // Missing requirements are asked, and added only once confirmed.
    const powerBi = review.getByRole("group", { name: "Power BI" });
    await expect(powerBi.getByText(tc.question.replace("{{requirement}}", "Power BI"))).toBeVisible();
    await expect(review.getByRole("group", { name: "Management d'équipe" })).toBeVisible();
    await powerBi.getByRole("button", { name: tc.confirm }).click();
    await expect(powerBi.getByRole("button", { name: tc.confirm })).toHaveAttribute("aria-pressed", "true");
    const declined = review.getByRole("group", { name: "Management d'équipe" }).getByRole("button", { name: tc.decline });
    const notChosen = review.getByRole("group", { name: "Management d'équipe" }).getByRole("button", { name: tc.confirm });
    await declined.click();
    // The answer shows on screen, not only to assistive technology.
    await expect(declined).toHaveAttribute("aria-pressed", "true");
    const look = (button: Locator) => button.evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(await look(declined)).not.toBe(await look(notChosen));
    await expect(review.getByText(`${tc.sections.skills} · ${tc.kinds.added} · Power BI`)).toBeVisible();
    await expect(review.getByText(`${tc.sections.skills} · ${tc.kinds.added} · Management d'équipe`)).toHaveCount(0);
    const after = await scores(review);
    expect(after.master).toBe(before.master);
    expect(after.tailored).toBeGreaterThan(after.master);

    // Each change is accepted or rejected on its own (#161): accepted until rejected, except one
    // taken from the Job Offer, which waits for an explicit accept and is not saved without it.
    await expect(review.getByText(tc.changesIntro)).toBeVisible();
    await expect(headline.getByRole("button", { name: tc.accept })).toHaveAttribute("aria-pressed", "true");
    await expect(job.getByRole("button", { name: tc.accept })).toHaveAttribute("aria-pressed", "false");
    await expect(job.getByRole("button", { name: tc.reject })).toHaveAttribute("aria-pressed", "false");
    await expect(job.getByText(tc.awaitingAccept)).toBeVisible();
    await expect(review.getByText(tc.pendingHint)).toBeVisible();
    const cut = review.getByRole("listitem").filter({ hasText: `${tc.sections.experience} · ${tc.kinds.cut}` });
    await cut.getByRole("button", { name: tc.reject }).click();
    await expect(cut.getByRole("button", { name: tc.reject })).toHaveAttribute("aria-pressed", "true");
    await expect(cut.getByRole("button", { name: tc.accept })).toHaveAttribute("aria-pressed", "false");
    await reordered.getByRole("button", { name: tc.reject }).click();

    await review.getByRole("button", { name: tc.save }).click();

    await expect(section(page).getByRole("status")).toHaveText(tc.saved);
    await page.reload();
    const saved = section(page).getByRole("group", { name: tc.savedTitle });
    await expect(saved.getByText("Directrice financière (adapté, fr)")).toBeVisible();
    await expect(saved.getByText(tc.skillsLine.replace("{{skills}}", "Consolidation, IFRS, SAP, Power BI"))).toBeVisible();
    // The rejected cut and the unaccepted wording from the Job Offer keep the Master CV's.
    const jobs = saved.getByRole("list", { name: tc.sections.experience }).getByRole("listitem");
    await expect(jobs).toHaveCount(2);
    await expect(jobs.first().getByText("Consolidation IFRS.", { exact: true })).toBeVisible();
    await expect(jobs.nth(1)).toContainText("Contrôleuse de gestion · Danone · 1995 – 2005");
    await expect(saved.getByRole("list", { name: tc.sections.education })).toHaveText("Master Finance · ESSEC · 1994");
    await expect(saved.getByRole("list", { name: tc.sections.languages })).toHaveText("Anglais · courant");
    await expect(proposal(page)).toHaveCount(0);

    // The section's text meets the accessibility floor (ADR-0009).
    for (const t of await renderedTexts(page)) {
      expect.soft(t.fontSizePx, `font size of "${t.text}"`).toBeGreaterThanOrEqual(16);
      expect.soft(t.contrast, `contrast of "${t.text}"`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("a change taken from the Job Offer is saved once the Candidate accepts it, and a rejected one never is (#161)", async ({ page }) => {
    await openApplication(page, FRENCH);
    await section(page).getByRole("button", { name: tc.propose }).click();
    const review = proposal(page);
    const job = review.getByRole("listitem").filter({ hasText: `${tc.sections.experience} · ${tc.kinds.rephrased}` });
    const headline = review.getByRole("listitem").filter({ hasText: `${tc.sections.headline} · ${tc.kinds.rephrased}` });

    await job.getByRole("button", { name: tc.accept }).click();
    await headline.getByRole("button", { name: tc.reject }).click();

    await expect(job.getByRole("button", { name: tc.accept })).toHaveAttribute("aria-pressed", "true");
    await expect(job.getByText(tc.awaitingAccept)).toHaveCount(0);
    await expect(review.getByText(tc.pendingHint)).toHaveCount(0);
    await review.getByRole("button", { name: tc.save }).click();
    await expect(section(page).getByRole("status")).toHaveText(tc.saved);
    const saved = section(page).getByRole("group", { name: tc.savedTitle });
    await expect(saved.getByText("Consolidation IFRS. pour « Directeur administratif et financier (H/F) »")).toBeVisible();
    await expect(saved.getByText("Directrice financière (adapté, fr)")).toHaveCount(0);
    await expect(saved.getByText("Directrice financière", { exact: true })).toBeVisible();
  });

  test("the words flagged as taken from the Job Offer are meaningful terms, not word fragments or everyday words (#161)", async ({ page }) => {
    await openApplication(page, {
      title: "Membre Directeur forte travailler jusqu'à",
      content: "Membre de l'équipe, Directeur forte de ses atouts, travailler jusqu'à la clôture.",
      skills: ["IFRS"],
    });
    await section(page).getByRole("button", { name: tc.propose }).click();
    const job = proposal(page).getByRole("listitem").filter({ hasText: `${tc.sections.experience} · ${tc.kinds.rephrased}` });
    await expect(job.getByRole("note")).toHaveText(tc.fromOffer.replace("{{words}}", "Directeur"));
    for (const noise of ["jusqu", "forte", "Membre", "travailler"]) {
      await expect(job.getByRole("note")).not.toContainText(noise);
    }
  });

  test("only the changes the Candidate accepts are saved, and a flagged change is never saved without its explicit accept (#161, HTTP API)", async ({ page }) => {
    const id = await openApplication(page, FRENCH);
    const url = `/api/applications/${id}/tailored-cv`;
    type Proposed = { revision: string; changes: { id: string; section: string; fromOffer?: string[] }[] };
    // Saving consumes the proposal reviewed, so each save starts from a proposal of its own.
    const propose = async (): Promise<Proposed> => {
      const response = await page.request.post(url, { data: { language: "fr" }, headers: { origin } });
      expect(response.status(), await response.text()).toBe(200);
      return (await response.json()).proposal;
    };
    const save = async ({ revision }: Proposed, accepted: string[]) => {
      const response = await page.request.post(`${url}/save`, { data: { revision, accepted }, headers: { origin } });
      expect(response.status(), await response.text()).toBe(200);
      return (await response.json()).saved.content;
    };

    // Nothing accepted: the saved Tailored CV is the Master CV, flagged wording included.
    const first = await propose();
    expect(first.changes.some((change) => change.fromOffer?.length)).toBe(true);
    const kept = await save(first, []);
    expect(kept.headline).toBe(masterCv.headline);
    expect(kept.experience).toEqual(masterCv.experience);
    expect(kept.skills).toEqual(masterCv.skills);

    // Only the headline change accepted: it is saved, the flagged wording is not.
    const second = await propose();
    const headlineOnly = second.changes.filter((change) => change.section === "headline").map((change) => change.id);
    expect(headlineOnly.length).toBe(1);
    const partial = await save(second, headlineOnly);
    expect(partial.headline).toBe("Directrice financière (adapté, fr)");
    expect(partial.experience[0].description).toBe("Consolidation IFRS.");

    // Accepting the flagged change explicitly is what saves its wording.
    const third = await propose();
    const flagged = third.changes.filter((change) => change.fromOffer?.length).map((change) => change.id);
    const explicit = await save(third, flagged);
    expect(explicit.experience[0].description).toContain("pour « Directeur administratif et financier (H/F) »");
  });

  test("a Tailored CV is written in the Job Offer's language by default, or in the Document Language the Candidate chooses", async ({ page }) => {
    await openApplication(page, ENGLISH);
    await expect(documentLanguage(page)).toHaveValue("en");
    await section(page).getByRole("button", { name: tc.propose }).click();
    await expect(proposal(page).getByText(tc.writtenIn.en)).toBeVisible();
    await expect(proposal(page).getByText("Directrice financière (adapté, en)")).toBeVisible();
    // The Master CV is in French: the Job Offer's words were checked through a translation, and the Candidate is told (#68).
    await expect(proposal(page).getByText(tc.offerWordingTranslated)).toBeVisible();
    // Written in English through and through: a language is translated, shown against the Master CV's.
    const language = proposal(page).getByRole("listitem").filter({ hasText: `${tc.sections.languages} · ${tc.kinds.rephrased} · Anglais · courant` });
    await expect(language.getByText("English · fluent")).toBeVisible();

    await documentLanguage(page).selectOption({ label: fr.tailoredDocuments.languages.fr });
    await proposal(page).getByRole("button", { name: tc.proposeAgain }).click();
    await expect(proposal(page).getByText("Directrice financière (adapté, fr)")).toBeVisible();

    // The Application keeps the language chosen, for all its Tailored Documents.
    await page.reload();
    await expect(documentLanguage(page)).toHaveValue("fr");
  });

  test("when the AI Coach cannot propose one, the Candidate is told to try again later", async ({ page }) => {
    await openApplication(page, { title: "DAF (H/F)", content: "Vous pilotez la finance. E2E_AI_DOWN", skills: [] });

    await section(page).getByRole("button", { name: tc.propose }).click();

    await expect(section(page).getByRole("alert")).toHaveText(tc.unavailable);
    await expect(section(page).getByRole("button", { name: tc.propose })).toBeVisible();
  });
  test("only the proposal the Candidate reviewed is saved, not one proposed meanwhile in another tab", async ({ page }) => {
    const id = await openApplication(page, FRENCH);
    await section(page).getByRole("button", { name: tc.propose }).click();
    await expect(proposal(page).getByText(tc.writtenIn.fr)).toBeVisible();

    // Another tab proposes again, in English.
    const elsewhere = await page.request.post(`/api/applications/${id}/tailored-cv`, { data: { language: "en" }, headers: { origin } });
    expect(elsewhere.status(), await elsewhere.text()).toBe(200);
    await proposal(page).getByRole("button", { name: tc.save }).click();

    await expect(section(page).getByRole("alert")).toHaveText(tc.proposalChanged);
    await expect(proposal(page).getByText(tc.writtenIn.en)).toBeVisible();
    await expect(section(page).getByRole("group", { name: tc.savedTitle })).toHaveCount(0);

    // Once the English one is reviewed, it can be saved.
    await proposal(page).getByRole("button", { name: tc.save }).click();
    await expect(section(page).getByRole("status")).toHaveText(tc.saved);
    await expect(section(page).getByRole("group", { name: tc.savedTitle }).getByText(tc.writtenIn.en)).toBeVisible();
  });
});

// Issue #65: a Tailored CV reply the AI Coach gets wrong (prose, cut short, not
// JSON) used to end in a silent 503. Now the server logs why it refused the reply
// (never the CV or the Job Offer) and asks the AI Coach once more before telling
// the Candidate it is unavailable. The fake Mistral scripts the replies
// (E2E_CV_REPLIES) and logs each call, so the server log shows how often the AI
// Coach was asked.
test.describe("Tailored CV: a refused AI Coach reply is logged and asked for once more", () => {
  const log = () => readFileSync(process.env.E2E_SERVER_LOG!, "utf8");

  /** The server log written from now on, as lines. */
  function logFromNow(): () => string[] {
    const from = statSync(process.env.E2E_SERVER_LOG!).size;
    return () => Buffer.from(log(), "utf8").subarray(from).toString("utf8").split("\n");
  }

  /** A Master CV and Job Offer that only this test uses, and the Job Offer's scripted replies. */
  function scripted(kinds: string[]) {
    const id = unique();
    const secret = `CV-SECRET-${id}`;
    const cv = {
      ...masterCv,
      headline: `Directrice financière ${secret}`,
      experience: [{ ...masterCv.experience[0]!, description: `Consolidation IFRS ${secret}.` }, masterCv.experience[1]!],
    };
    const offer = { title: "DAF (H/F)", content: `Vous pilotez la finance. OFFER-SECRET-${id} E2E_CV_REPLIES=${kinds.join(",")}@${id}`, skills: [] };
    const calls = (lines: string[]) => lines.filter((line) => line.startsWith(`[fake-mistral] tailored-cv reply `) && line.includes(` for ${id}: `));
    const refusals = (lines: string[]) => lines.filter((line) => line.includes("[tailored-cv] refused the AI Coach's Tailored CV reply"));
    return { id, secret, cv, offer, calls, refusals };
  }

  /** No line of `lines` holds the Candidate's CV or the Job Offer. */
  function expectNoCvIn(lines: string[], id: string) {
    for (const line of lines) {
      expect(line, "a server log line holds the CV").not.toContain(`CV-SECRET-${id}`);
      expect(line, "a server log line holds the Job Offer").not.toContain(`OFFER-SECRET-${id}`);
    }
  }

  for (const [kind, reason] of [
    ["prose", "no_json"],
    ["truncated", "no_json"],
  ] as const) {
    test(`a reply ${kind === "prose" ? "wrapped in prose" : "cut short"} is logged with why, and the AI Coach is asked exactly once more`, async ({ page }) => {
      const s = scripted([kind, "valid"]);
      await openApplication(page, s.offer, s.cv);
      const lines = logFromNow();

      await section(page).getByRole("button", { name: tc.propose }).click();

      await expect(section(page).getByRole("status")).toHaveText(tc.proposed);
      await expect.poll(() => s.calls(lines()).length).toBe(2);
      expect(s.calls(lines())).toEqual([`[fake-mistral] tailored-cv reply 1 for ${s.id}: ${kind}`, `[fake-mistral] tailored-cv reply 2 for ${s.id}: valid`]);
      const refused = s.refusals(lines());
      expect(refused).toHaveLength(1);
      expect(refused[0]).toContain(`reason=${reason}`);
      expect(refused[0]).toMatch(/length=\d+/);
      expect(refused[0]).toContain("provider=mistral");
      expect(refused[0]).toMatch(/model=\S+/);
      expectNoCvIn(lines(), s.id);
    });
  }

  test("a valid reply on the retry is the proposal the Candidate reviews", async ({ page }) => {
    const s = scripted(["prose", "valid"]);
    await openApplication(page, s.offer, s.cv);
    const lines = logFromNow();

    const proposed = page.waitForResponse((response) => response.url().endsWith("/tailored-cv") && response.request().method() === "POST");
    await section(page).getByRole("button", { name: tc.propose }).click();

    expect((await proposed).status()).toBe(200);
    await expect(section(page).getByRole("status")).toHaveText(tc.proposed);
    // The retry's reply is the one proposed: it cuts every job but the first.
    await expect(proposal(page).getByText(`${tc.sections.experience} · ${tc.kinds.cut} · Contrôleuse de gestion · Danone · 1995 – 2005`)).toBeVisible();
    await expect(section(page).getByRole("alert")).toHaveCount(0);
    expect(s.calls(lines())).toHaveLength(2);
  });

  test("two refused replies tell the Candidate to try again later, with two warnings and no third ask", async ({ page }) => {
    const s = scripted(["prose", "truncated", "valid"]);
    await openApplication(page, s.offer, s.cv);
    const lines = logFromNow();

    const proposed = page.waitForResponse((response) => response.url().endsWith("/tailored-cv") && response.request().method() === "POST");
    await section(page).getByRole("button", { name: tc.propose }).click();

    expect((await proposed).status()).toBe(503);
    await expect(section(page).getByRole("alert")).toHaveText(tc.unavailable);
    await expect(section(page).getByRole("button", { name: tc.propose })).toBeVisible();
    await expect.poll(() => s.refusals(lines()).length).toBe(2);
    expect(s.calls(lines())).toHaveLength(2);
    expect(s.refusals(lines())[0]).toContain("attempt 1/2");
    expect(s.refusals(lines())[1]).toContain("attempt 2/2");
    expectNoCvIn(lines(), s.id);
  });

  test("a reply that is not valid JSON is logged as such, never with the CV text it holds", async ({ page }) => {
    const s = scripted(["bad_json"]);
    await openApplication(page, s.offer, s.cv);
    const lines = logFromNow();

    await section(page).getByRole("button", { name: tc.propose }).click();

    await expect(section(page).getByRole("alert")).toHaveText(tc.unavailable);
    await expect.poll(() => s.refusals(lines()).length).toBe(2);
    for (const line of s.refusals(lines())) expect(line).toContain("reason=bad_json");
    expectNoCvIn(lines(), s.id);
  });
});
