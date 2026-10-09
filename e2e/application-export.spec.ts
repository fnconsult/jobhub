import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import mammoth from "mammoth";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #67: on the application page, the Candidate downloads the saved Tailored
// CV and the Cover Letter as a PDF or a Word file, with the CV Templates of the
// Master CV export. Only their own Application, and only once the document is saved.
// The AI Coach is Mistral, faked by e2e/support/fake-mistral.mjs.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const masterCv = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "06 12 34 56 78",
  location: "Lyon",
  summary: "",
  experience: [{ title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2005 – 2024", description: "Consolidation IFRS." }],
  education: [{ degree: "Master Finance", institution: "ESSEC", year: "1994" }],
  skills: ["Consolidation", "IFRS", "SAP"],
  languages: [{ name: "Anglais", level: "courant" }],
};

const CONTENT_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/** Signs a new Candidate in and saves an Application on a French Job Offer at "Acme Industrie". */
async function openApplication(page: Page, label: string): Promise<string> {
  await signInWithMagicLink(page, newAddress(label));
  const profile = await page.request.post("/api/profiles", {
    data: { masterCv, searchCriteria: { targetRole: "DAF", location: "Lyon" } },
    headers: { origin },
  });
  expect(profile.status(), await profile.text()).toBe(201);
  const captured = await page.request.post("/api/job-offers", {
    data: {
      source: { url: `https://www.apec.fr/offres/${unique()}` },
      title: "Directeur administratif et financier (H/F)",
      content: "Acme Industrie recrute son DAF. Vous pilotez la consolidation IFRS sous SAP.",
      skills: ["IFRS", "SAP"],
      employer: "Acme Industrie",
      location: "Lyon",
    },
    headers: { origin },
  });
  expect(captured.status(), await captured.text()).toBe(200);
  const saved = await page.request.post("/api/applications", {
    data: { jobOfferId: (await captured.json()).id, profileId: (await profile.json()).id },
    headers: { origin },
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  return (await saved.json()).id as string;
}

async function saveTailoredCv(page: Page, id: string) {
  const proposed = await page.request.post(`/api/applications/${id}/tailored-cv`, { data: {}, headers: { origin } });
  expect(proposed.status(), await proposed.text()).toBe(200);
  const { revision } = (await proposed.json()).proposal;
  const saved = await page.request.post(`/api/applications/${id}/tailored-cv/save`, { data: { revision }, headers: { origin } });
  expect(saved.status(), await saved.text()).toBe(200);
}

async function draftCoverLetter(page: Page, id: string) {
  const drafted = await page.request.post(`/api/applications/${id}/tailored-documents`, { data: { document: "cover_letter" }, headers: { origin } });
  expect(drafted.status(), await drafted.text()).toBe(200);
}

const exportUrl = (id: string, document: "tailored-cv" | "cover-letter", format: string, template = "classic") =>
  `/api/applications/${id}/${document}/export?format=${format}&template=${template}`;

test.describe("exporting the Tailored CV and the Cover Letter", () => {
  test("the saved Tailored CV and the Cover Letter download as PDF and Word, named after the Candidate and the employer", async ({ page }) => {
    const id = await openApplication(page, "application-export");
    await saveTailoredCv(page, id);
    await draftCoverLetter(page, id);

    for (const [document, prefix] of [
      ["tailored-cv", "CV"],
      ["cover-letter", "Lettre-de-motivation"],
    ] as const) {
      for (const format of ["pdf", "docx"] as const) {
        const response = await page.request.get(exportUrl(id, document, format, "modern"));
        expect(response.status(), `${document} ${format}`).toBe(200);
        expect(response.headers()["content-type"]).toBe(CONTENT_TYPES[format]);
        expect(response.headers()["content-disposition"]).toBe(`attachment; filename="${prefix}-Marie-Dupont-Acme-Industrie.${format}"`);
        expect((await response.body()).length).toBeGreaterThan(0);
      }
    }

    const letter = await page.request.get(exportUrl(id, "cover-letter", "docx"));
    const text = (await mammoth.extractRawText({ buffer: await letter.body() })).value;
    expect(text).toContain("marie.dupont@example.fr");
    expect(text).toContain("Acme Industrie");

    expect((await page.request.get(exportUrl(id, "tailored-cv", "odt"))).status()).toBe(400);
    expect((await page.request.get(exportUrl(id, "cover-letter", "pdf", "fancy"))).status()).toBe(400);
  });

  test("another Candidate's Application, or one without a saved document, returns 404", async ({ page, browser }) => {
    const id = await openApplication(page, "application-export-unsaved");
    for (const document of ["tailored-cv", "cover-letter"] as const) {
      expect((await page.request.get(exportUrl(id, document, "pdf"))).status(), document).toBe(404);
    }

    // A proposal under review is not a saved Tailored CV.
    expect((await page.request.post(`/api/applications/${id}/tailored-cv`, { data: {}, headers: { origin } })).status()).toBe(200);
    expect((await page.request.get(exportUrl(id, "tailored-cv", "pdf"))).status()).toBe(404);

    const owned = id;
    await saveTailoredCv(page, owned);
    await draftCoverLetter(page, owned);
    expect((await page.request.get(exportUrl(owned, "tailored-cv", "pdf"))).status()).toBe(200);
    const stranger = await browser.newPage({ baseURL: origin });
    expect((await stranger.request.get(exportUrl(owned, "tailored-cv", "pdf"))).status()).toBe(401);
    await signInWithMagicLink(stranger, newAddress("application-export-stranger"));
    for (const document of ["tailored-cv", "cover-letter"] as const) {
      expect((await stranger.request.get(exportUrl(owned, document, "pdf"))).status(), document).toBe(404);
    }
    await stranger.close();
  });

  test("the application page shows the download controls only once the document is saved", async ({ page }) => {
    const id = await openApplication(page, "application-export-page");
    await page.goto(`/candidatures/${id}`);
    const cvDownload = page.getByRole("region", { name: fr.tailoredCv.title }).getByRole("group", { name: fr.applicationExport.tailoredCv.title });
    const letterDownload = page.getByRole("region", { name: fr.tailoredDocuments.title }).getByRole("group", { name: fr.applicationExport.coverLetter.title });
    await expect(cvDownload).toHaveCount(0);
    await expect(letterDownload).toHaveCount(0);

    await saveTailoredCv(page, id);
    await draftCoverLetter(page, id);
    await page.reload();

    for (const download of [cvDownload, letterDownload]) {
      await expect(download.getByRole("radio", { name: fr.cvExport.templates.classic.name })).toBeChecked();
      await expect(download.getByRole("button", { name: fr.cvExport.docx })).toBeVisible();
    }
    await cvDownload.getByRole("radio", { name: fr.cvExport.templates.compact.name }).check();
    const [file] = await Promise.all([page.waitForEvent("download"), cvDownload.getByRole("button", { name: fr.cvExport.pdf }).click()]);
    expect(file.suggestedFilename()).toBe("CV-Marie-Dupont-Acme-Industrie.pdf");
    const [letter] = await Promise.all([page.waitForEvent("download"), letterDownload.getByRole("button", { name: fr.cvExport.docx }).click()]);
    expect(letter.suggestedFilename()).toBe("Lettre-de-motivation-Marie-Dupont-Acme-Industrie.docx");
  });
});
