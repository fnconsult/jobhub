import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #20: the Candidate downloads their Master CV as a PDF or a Word file,
// laid out with the CV Template they choose. Both files say the same thing.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;

const masterCv = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "06 12 34 56 78",
  location: "Lyon",
  summary: "25 ans d'expérience dans l'industrie.",
  experience: [{ title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2015 – 2024", description: "Pilotage financier." }],
  education: [{ degree: "Master Finance", institution: "ESSEC", year: "1998" }],
  skills: ["IFRS", "SAP"],
  languages: [{ name: "Anglais", level: "courant" }],
};

const expectedText =
  "Marie Dupont Directrice financière marie.dupont@example.fr · 06 12 34 56 78 · Lyon " +
  "Profil 25 ans d'expérience dans l'industrie. " +
  "Expérience professionnelle Directrice financière — Groupe Seb, Lyon — 2015 – 2024 Pilotage financier. " +
  "Formation Master Finance — ESSEC — 1998 " +
  "Compétences IFRS · SAP " +
  "Langues Anglais : courant";

async function candidateWithProfile(page: Page, label: string): Promise<string> {
  await signInWithMagicLink(page, newAddress(label));
  const created = await page.request.post("/api/profiles", {
    headers: { origin },
    data: { masterCv, searchCriteria: { targetRole: "Directrice financière", location: "Lyon" } },
  });
  expect(created.status()).toBe(201);
  return (await created.json()).id;
}

async function textOf(name: string, bytes: Buffer): Promise<string> {
  const text = name.endsWith(".pdf")
    ? (await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: true })).text
    : (await mammoth.extractRawText({ buffer: bytes })).value;
  return text.replace(/\s+/g, " ").trim();
}

async function download(page: Page, button: string): Promise<{ name: string; text: string }> {
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: button }).click()]);
  const bytes = readFileSync((await file.path())!);
  return { name: file.suggestedFilename(), text: await textOf(file.suggestedFilename(), bytes) };
}

test.describe("exporting the Master CV", () => {
  test("the Candidate picks a CV Template and downloads the same CV as a PDF and as a Word file", async ({ page }) => {
    const id = await candidateWithProfile(page, "export");
    await page.goto(`/profils/${id}`);

    const form = page.getByRole("region", { name: fr.cvExport.title });
    const templates = form.getByRole("group", { name: fr.cvExport.template });
    for (const template of ["classic", "modern", "compact"]) {
      await expect(templates.getByRole("radio", { name: fr.cvExport.templates[template].name })).toBeVisible();
    }
    await expect(templates.getByRole("radio", { name: fr.cvExport.templates.classic.name })).toBeChecked();
    await templates.getByRole("radio", { name: fr.cvExport.templates.modern.name }).check();

    const pdf = await download(page, fr.cvExport.pdf);
    const docx = await download(page, fr.cvExport.docx);

    expect(pdf.name).toBe("CV-Marie-Dupont.pdf");
    expect(docx.name).toBe("CV-Marie-Dupont.docx");
    expect(pdf.text).toBe(expectedText);
    expect(docx.text).toBe(expectedText);
  });

  test("only the Profile's Candidate can download its Master CV", async ({ page, browser }) => {
    const id = await candidateWithProfile(page, "export-owner");
    const url = `/api/profiles/${id}/master-cv/export?format=pdf&template=classic`;
    const own = await page.request.get(url);
    expect(own.status()).toBe(200);
    expect(own.headers()["content-type"]).toBe("application/pdf");
    expect(own.headers()["content-disposition"]).toBe(`attachment; filename="CV-Marie-Dupont.pdf"`);

    expect((await page.request.get(`/api/profiles/${id}/master-cv/export?format=odt&template=classic`)).status()).toBe(400);
    expect((await page.request.get(`/api/profiles/${id}/master-cv/export?format=pdf&template=fancy`)).status()).toBe(400);

    const stranger = await browser.newPage({ baseURL: origin });
    expect((await stranger.request.get(url)).status()).toBe(401);
    await signInWithMagicLink(stranger, newAddress("export-stranger"));
    expect((await stranger.request.get(url)).status()).toBe(404);
    await stranger.close();
  });
});
