import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { docxCv, MARIE_DUPONT_CV } from "../apps/web/src/cv/test-support";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #260: the degraded paths of an AI feature become warnings on the related AI call, seen by a
// super-admin in the Journaux IA. Each case is driven from the Candidate's side through the public
// entry point (HTTP API or upload page) with the AI faked inside the server (fake-mistral.mjs), then
// read back in the Back Office: the call's Outcome (Avertissement, or Échec for a failed call) and its code,
// found with the « Résultat » filter and the « Raison » filter. No Candidate text may reach a code or wording.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const admin = fr.admin;
const origin = process.env.E2E_WEB_ORIGIN!;
const SUPER_ADMIN = "ai-warnings-office@e2e.jobbbox.test";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const masterCv = (headline: string, secret = "") => ({
  fullName: "Marie Dupont",
  email: "marie.dupont@example.fr",
  phone: "06 12 34 56 78",
  location: "Lyon",
  headline,
  summary: "",
  experience: [{ title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2005 – 2024", description: `Pilotage financier. ${secret}` }],
  education: [],
  skills: ["IFRS", "Consolidation"],
  languages: [],
});

async function createProfile(page: Page, cv = masterCv("Directrice financière")): Promise<string> {
  const created = await page.request.post("/api/profiles", {
    headers: { origin },
    data: { masterCv: cv, searchCriteria: { targetRole: "DAF", locations: ["Lyon"], contractTypes: ["cdi"] } },
  });
  expect(created.status(), await created.text()).toBe(201);
  return (await created.json()).id;
}

/** The Journaux IA rows of one Candidate's calls for a task, filtered by Résultat and Raison, as the Administrator sees them. */
async function findRows(admin_: Page, email: string, task: string, outcome: "warning" | "failed", reason: string) {
  await admin_.goto("/admin/journaux-ia");
  await admin_.getByLabel(admin.aiMessages.email).fill(email);
  await admin_.getByLabel(admin.aiMessages.task).selectOption(task);
  await admin_.getByLabel(admin.aiMessages.result).selectOption(outcome);
  await admin_.getByLabel(admin.aiMessages.reason).selectOption(reason);
  const rows = admin_.getByRole("table", { name: admin.aiMessages.caption }).getByRole("row").filter({ hasText: email });
  // The call is recorded just after its reply: the list may need asking again.
  await expect(async () => {
    await admin_.getByRole("button", { name: admin.aiMessages.apply }).click();
    await expect(rows.first()).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await expect(admin_).toHaveURL(new RegExp(`outcome=${outcome}`));
  await expect(admin_).toHaveURL(new RegExp(`reason=${reason}`));
  return rows;
}

/** Opens the first row and returns its « Pourquoi » region's text (the warnings are listed in it). */
async function openWarnings(admin_: Page, rows: ReturnType<Page["locator"]>) {
  await rows.first().getByRole("link", { name: admin.aiMessages.open }).click();
  const region = admin_.getByRole("region", { name: admin.aiMessages.why });
  await expect(region).toBeVisible();
  return (await region.innerText()).replace(/\s+/g, " ");
}

test.describe("AI call warnings in the Journaux IA (#260)", () => {
  let adminPage: Page;
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ baseURL: origin, locale: "en-US" });
    adminPage = await context.newPage();
    await signInWithMagicLink(adminPage, SUPER_ADMIN);
  });
  test.afterAll(async () => {
    await adminPage.context().close();
  });

  test("a Playbook Agent that fails is left out: the AI Coach's reply call is a warning playbook_agent_skipped, listed by the Avertissement filter", async ({ page }) => {
    const email = newAddress("warn-agent");
    await signInWithMagicLink(page, email);
    await createProfile(page);
    const secret = `AGENT-SECRET-${unique()}`;
    // A call that works too: it must not be listed under Avertissement.
    const fine = await page.request.post("/api/coach", { headers: { origin }, data: { message: "Bonjour" } });
    expect(fine.status(), await fine.text()).toBe(200);
    const reply = await page.request.post("/api/coach", {
      headers: { origin },
      data: { message: `Mon entretien ? ${secret} E2E_CONSULT=interview-journey-stages,interview-psychology E2E_AGENT_DOWN=interview-psychology` },
    });
    expect(reply.status(), await reply.text()).toBe(200);

    const rows = await findRows(adminPage, email, "coaching", "warning", "playbook_agent_skipped");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(`${admin.aiMessages.outcomes.warning} · ${fr.failureReasons.playbook_agent_skipped}`);
    const warnings = await openWarnings(adminPage, rows);
    expect(warnings).toContain(fr.failureReasons.playbook_agent_skipped);
    expect(warnings).not.toContain(secret);
    expect(warnings).not.toContain("Marie");

    // The Avertissement filter alone lists it, and not the call that worked.
    await adminPage.goto(`/admin/journaux-ia?email=${encodeURIComponent(email)}&outcome=warning`);
    const listed = adminPage.getByRole("table", { name: admin.aiMessages.caption }).getByRole("row").filter({ hasText: email });
    await expect(listed).toHaveCount(1);
    await expect(listed.first()).toContainText(admin.aiMessages.outcomes.warning);
    await expect(listed.first()).not.toContainText(admin.aiMessages.outcomes.ok);
  });

  test("a CV the AI cannot read is read by rules: the failed reading call carries cv_reading_fallback", async ({ page }) => {
    const email = newAddress("warn-cv");
    await signInWithMagicLink(page, email);
    await page.goto("/profils/nouveau");
    const secret = `CV-SECRET-${unique()}`;
    const lines = [...MARIE_DUPONT_CV, "Centres d'intérêt", `E2E_AI_DOWN ${secret}`];
    await page.getByLabel(fr.cvUpload.fileLabel).setInputFiles({ name: "cv.docx", mimeType: DOCX, buffer: Buffer.from(await docxCv(lines)) });
    await page.getByRole("button", { name: fr.cvUpload.submit }).click();
    await expect(page.getByLabel(fr.cvReview.fullName)).toHaveValue("Marie Dupont");

    const rows = await findRows(adminPage, email, "cv_parsing", "failed", "cv_reading_fallback");
    await expect(rows.first()).toContainText(admin.aiMessages.outcomes.failed);
    const warnings = await openWarnings(adminPage, rows);
    expect(warnings).toContain(fr.failureReasons.cv_reading_fallback);
    expect(warnings).not.toContain(secret);
    expect(warnings).not.toContain("Marie Dupont");
    expect(warnings).not.toContain("marie.dupont@example.fr");
  });

  test("a Tailored CV reply that is refused is recorded as the warning tailored_cv_refused, without the CV's text", async ({ page }) => {
    const email = newAddress("warn-tcv");
    await signInWithMagicLink(page, email);
    const id = unique();
    const secret = `CV-SECRET-${id}`;
    const profileId = await createProfile(page, masterCv(`Directrice financière ${secret}`, secret));
    const captured = await page.request.post("/api/job-offers", {
      headers: { origin },
      data: {
        source: { url: `https://www.apec.fr/offres/${id}` },
        title: "DAF (H/F)",
        content: `Vous pilotez la finance. OFFER-SECRET-${id} E2E_CV_REPLIES=prose@${id}`,
        skills: [],
        employer: "Acme Industrie",
        location: "Lyon",
      },
    });
    expect(captured.status(), await captured.text()).toBe(200);
    const saved = await page.request.post("/api/applications", { headers: { origin }, data: { jobOfferId: (await captured.json()).id, profileId } });
    expect(saved.ok(), await saved.text()).toBe(true);
    await page.goto(`/candidatures/${(await saved.json()).id}/documents`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: fr.tailoredCv.propose }).click();
    await expect(page.getByRole("alert").filter({ hasText: fr.tailoredCv.unavailable })).toBeVisible();

    const rows = await findRows(adminPage, email, "writing", "warning", "tailored_cv_refused");
    await expect(rows.first()).toContainText(`${admin.aiMessages.outcomes.warning} · ${fr.failureReasons.tailored_cv_refused}`);
    const warnings = await openWarnings(adminPage, rows);
    expect(warnings).toContain(fr.failureReasons.tailored_cv_refused);
    expect(warnings).not.toContain(secret);
    expect(warnings).not.toContain(`OFFER-SECRET-${id}`);
  });

  test("a Job Offer's text the AI cannot read leaves the Match Score on its structured data: the call carries match_score_text_unread", async ({ page }) => {
    const email = newAddress("warn-match");
    await signInWithMagicLink(page, email);
    const id = unique();
    const captured = await page.request.post("/api/job-offers", {
      headers: { origin },
      data: {
        source: { url: `https://iledefrance.gestmax.fr/${id}/1/chef-de-projet` },
        title: "Chef de projet finance (H/F)",
        content: `Type de contrat : CDI. Ville : Lyon. E2E_AI_DOWN OFFER-SECRET-${id}`,
      },
    });
    expect(captured.status(), await captured.text()).toBe(200);
    const scored = await page.request.post("/api/match-score", {
      headers: { origin },
      data: {
        jobOfferId: (await captured.json()).id,
        cv: masterCv("Directrice financière"),
        searchCriteria: { targetRole: "Directrice administrative et financière", locations: ["Lyon"], contractTypes: ["cdi"] },
      },
    });
    expect(scored.status(), await scored.text()).toBe(200);
    expect((await scored.json()).offerTextUnread).toBe(true);

    const rows = await findRows(adminPage, email, "offer_analysis", "failed", "match_score_text_unread");
    const warnings = await openWarnings(adminPage, rows);
    expect(warnings).toContain(fr.failureReasons.match_score_text_unread);
    expect(warnings).not.toContain(`OFFER-SECRET-${id}`);
  });
});
