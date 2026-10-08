import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { renderedTexts } from "./support/accessibility";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #19: the AI Coach drafts a Cover Letter and an Outreach Message (email
// or LinkedIn InMail) for an Application, in the Document Language, stored on
// the Application. The Candidate edits them or has them drafted again, then
// copies them or opens the message in their own mail client: nothing is sent
// (ADR-0005). The AI Coach is Mistral, faked by e2e/support/fake-mistral.mjs.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const td = fr.tailoredDocuments;
const origin = process.env.E2E_WEB_ORIGIN!;

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const masterCv = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [{ title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2005 – 2024", description: "Pilotage financier." }],
  education: [],
  skills: ["Consolidation", "IFRS", "SAP"],
  languages: [],
};

const FRENCH = {
  title: "Directeur administratif et financier (H/F)",
  content: "Acme Industrie recrute son DAF. Vous pilotez la clôture des comptes et vous encadrez une équipe de 12 personnes.",
};
const ENGLISH = {
  title: "Chief Financial Officer",
  content: "Globex is looking for a CFO who will lead the finance team. You have 15 years of experience and you are fluent in French.",
};

/** Signs a new Candidate in and opens a new Application on a Job Offer with this title and text. */
async function openApplication(page: Page, offer: { title: string; content: string }): Promise<string> {
  await signInWithMagicLink(page, newAddress("tailored-documents"));
  const profile = await page.request.post("/api/profiles", {
    data: { masterCv, searchCriteria: { targetRole: "DAF", location: "Lyon" } },
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
  await page.goto(`/candidatures/${id}`);
  return id;
}

const coverLetter = (page: Page) => page.getByRole("group", { name: td.coverLetter.title });
const outreachMessage = (page: Page) => page.getByRole("group", { name: td.outreachMessage.title });

test.describe("Cover Letter and Outreach Message drafts", () => {
  test("the AI Coach drafts a Cover Letter in the Job Offer's language; the Candidate edits it, copies it, and it is kept on the Application", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
    await openApplication(page, FRENCH);
    const letter = coverLetter(page);
    await expect(page.getByLabel(td.languageLabel)).toHaveValue("fr");
    await expect(letter.getByText(td.coverLetter.none)).toBeVisible();

    await letter.getByRole("button", { name: td.coverLetter.draft }).click();

    await expect(letter.getByRole("status")).toHaveText(td.drafted);
    await expect(letter.getByLabel(td.coverLetter.textLabel)).toHaveValue(`Lettre de motivation (fr) pour « ${FRENCH.title} ».`);
    await expect(letter.getByText(td.writtenIn.fr)).toBeVisible();

    await letter.getByLabel(td.coverLetter.textLabel).fill("Madame, Monsieur,\n\nMa lettre, revue par mes soins.");
    await letter.getByRole("button", { name: td.save }).click();
    await expect(letter.getByRole("status")).toHaveText(td.saved);
    await letter.getByRole("button", { name: td.copy }).click();
    await expect(letter.getByRole("status")).toHaveText(td.copied);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Madame, Monsieur,\n\nMa lettre, revue par mes soins.");

    await page.reload();
    await expect(coverLetter(page).getByLabel(td.coverLetter.textLabel)).toHaveValue("Madame, Monsieur,\n\nMa lettre, revue par mes soins.");

    // Drafting again replaces the text, edits included, as the hint warns.
    await expect(coverLetter(page).getByText(td.redraftHint)).toBeVisible();
    await coverLetter(page).getByRole("button", { name: td.redraft }).click();
    await expect(coverLetter(page).getByLabel(td.coverLetter.textLabel)).toHaveValue(`Lettre de motivation (fr) pour « ${FRENCH.title} ».`);
  });

  test("an Outreach Message is drafted as an email to open in the Candidate's mail client, or as an InMail to copy; nothing is sent", async ({ page }) => {
    await openApplication(page, FRENCH);
    const message = outreachMessage(page);

    await message.getByRole("button", { name: td.outreachMessage.draft }).click();

    await expect(message.getByLabel(td.outreachMessage.subjectLabel)).toHaveValue(`Candidature (fr) : ${FRENCH.title}`);
    await expect(message.getByLabel(td.outreachMessage.textLabel)).toHaveValue(`Message d'approche (fr, email) pour « ${FRENCH.title} ».`);
    await message.getByLabel(td.outreachMessage.textLabel).fill("Bonjour,\nJe me permets de vous écrire.");
    const mail = new URL((await message.getByRole("link", { name: td.outreachMessage.openInMail }).getAttribute("href"))!);
    expect(mail.protocol).toBe("mailto:");
    expect(mail.searchParams.get("subject")).toBe(`Candidature (fr) : ${FRENCH.title}`);
    expect(mail.searchParams.get("body")).toBe("Bonjour,\r\nJe me permets de vous écrire.");

    // As an InMail: drafted again for LinkedIn, to copy; there is no mail link for it.
    await message.getByLabel(td.outreachMessage.channelLabel).selectOption({ label: td.outreachMessage.channels.inmail });
    await message.getByRole("button", { name: td.redraft }).click();
    await expect(message.getByLabel(td.outreachMessage.textLabel)).toHaveValue(`Message d'approche (fr, inmail) pour « ${FRENCH.title} ».`);
    await expect(message.getByRole("link", { name: td.outreachMessage.openInMail })).toHaveCount(0);
    await page.reload();
    await expect(outreachMessage(page).getByLabel(td.outreachMessage.channelLabel)).toHaveValue("inmail");

    // Drafts only (ADR-0005): there is nothing to send them with.
    await expect(page.getByRole("region", { name: td.title }).getByRole("button", { name: /envoyer|send/i })).toHaveCount(0);
    expect((await page.request.post(`/api/applications/${page.url().split("/").at(-1)}/tailored-documents/send`, { headers: { origin } })).ok()).toBe(false);
  });

  test("drafts are written in English for an English Job Offer, and in the Document Language the Candidate chooses", async ({ page }) => {
    await openApplication(page, ENGLISH);
    await expect(page.getByLabel(td.languageLabel)).toHaveValue("en");
    await coverLetter(page).getByRole("button", { name: td.coverLetter.draft }).click();
    await expect(coverLetter(page).getByLabel(td.coverLetter.textLabel)).toHaveValue(`Lettre de motivation (en) pour « ${ENGLISH.title} ».`);
    await expect(coverLetter(page).getByText(td.writtenIn.en)).toBeVisible();

    await page.getByLabel(td.languageLabel).selectOption({ label: td.languages.fr });
    await outreachMessage(page).getByRole("button", { name: td.outreachMessage.draft }).click();
    await expect(outreachMessage(page).getByLabel(td.outreachMessage.textLabel)).toHaveValue(`Message d'approche (fr, email) pour « ${ENGLISH.title} ».`);

    // The Application keeps the language chosen.
    await page.reload();
    await expect(page.getByLabel(td.languageLabel)).toHaveValue("fr");

    // The section's text meets the accessibility floor (ADR-0009).
    for (const t of await renderedTexts(page)) {
      expect.soft(t.fontSizePx, `font size of "${t.text}"`).toBeGreaterThanOrEqual(16);
      expect.soft(t.contrast, `contrast of "${t.text}"`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("without a Company Dossier, both drafts are written from the Master CV and the Job Offer alone, addressed to no Suggested Contact Role", async ({ page }) => {
    // No Company Dossier is built for this Application: the AI Coach is handed
    // none, and the message names no contact roles.
    await openApplication(page, FRENCH);

    await coverLetter(page).getByRole("button", { name: td.coverLetter.draft }).click();
    await expect(coverLetter(page).getByLabel(td.coverLetter.textLabel)).toHaveValue(`Lettre de motivation (fr) pour « ${FRENCH.title} ».`);
    await outreachMessage(page).getByRole("button", { name: td.outreachMessage.draft }).click();
    await expect(outreachMessage(page).getByLabel(td.outreachMessage.textLabel)).toHaveValue(`Message d'approche (fr, email) pour « ${FRENCH.title} ».`);

    await expect(page.getByText(td.outreachMessage.contactRoles)).toHaveCount(0);
    await page.reload();
    await expect(outreachMessage(page).getByLabel(td.outreachMessage.textLabel)).toHaveValue(`Message d'approche (fr, email) pour « ${FRENCH.title} ».`);
    await expect(page.getByText(td.outreachMessage.contactRoles)).toHaveCount(0);
  });

  test("with a Company Dossier built, both drafts draw on it and the Outreach Message is addressed to its Suggested Contact Roles", async ({ page }) => {
    test.slow(); // building the dossier calls the (faked) register and web search
    await openApplication(page, FRENCH);
    await page.waitForLoadState("networkidle");
    const dossier = page.getByRole("region", { name: fr.companyDossier.title });
    await dossier.getByRole("button", { name: fr.companyDossier.build }).click();
    await expect(dossier.getByText("552100554", { exact: true })).toBeVisible({ timeout: 15_000 });

    await coverLetter(page).getByRole("button", { name: td.coverLetter.draft }).click();
    await expect(coverLetter(page).getByLabel(td.coverLetter.textLabel)).toHaveValue(
      `Lettre de motivation (fr) pour « ${FRENCH.title} ». Dossier : Acme Industrie (SIREN 552100554).`,
    );

    // Acme Industrie has 250 to 499 employees: the hiring manager, talent acquisition and the HR director.
    const roles = ["Responsable du poste à pourvoir", "Responsable du recrutement", "Directeur ou directrice des ressources humaines"];
    await outreachMessage(page).getByRole("button", { name: td.outreachMessage.draft }).click();
    await expect(outreachMessage(page).getByLabel(td.outreachMessage.textLabel)).toHaveValue(
      `Message d'approche (fr, email) pour « ${FRENCH.title} ». Dossier : Acme Industrie (SIREN 552100554). Contacts : ${roles.join(" ; ")}.`,
    );
    await expect(outreachMessage(page).getByText(td.outreachMessage.contactRoles)).toBeVisible();
    await expect(outreachMessage(page).getByRole("listitem")).toHaveText(roles);

    // Kept on the Application, contact roles included.
    await page.reload();
    await expect(outreachMessage(page).getByRole("listitem")).toHaveText(roles);
  });

  test("when the AI Coach cannot write, the Candidate is told to try again later", async ({ page }) => {
    await openApplication(page, { title: "DAF (H/F)", content: "Vous pilotez la finance. E2E_AI_DOWN" });

    await coverLetter(page).getByRole("button", { name: td.coverLetter.draft }).click();

    await expect(coverLetter(page).getByRole("alert")).toHaveText(td.unavailable);
    await expect(coverLetter(page).getByRole("button", { name: td.coverLetter.draft })).toBeVisible();
  });
});
