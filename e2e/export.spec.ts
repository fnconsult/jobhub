import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import JSZip from "jszip";
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

async function candidateWithProfile(page: Page, label: string, cv = masterCv): Promise<string> {
  await signInWithMagicLink(page, newAddress(label));
  const created = await page.request.post("/api/profiles", {
    headers: { origin },
    data: { masterCv: cv, searchCriteria: { targetRole: "Directrice financière", location: "Lyon" } },
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

  test("a name and symbols outside Western European letters come out the same in the PDF and the Word file", async ({ page }) => {
    const cv = {
      ...masterCv,
      fullName: "Zoë Łukasz-Øster Ğül",
      headline: "Ingénieure ≥ senior → lead 🚀",
      location: "Kraków / Москва",
      summary: "李明 · 김민준 · Ελληνικά ✓",
    };
    const id = await candidateWithProfile(page, "export-unicode", cv);
    await page.goto(`/profils/${id}`);

    const pdf = await download(page, fr.cvExport.pdf);
    const docx = await download(page, fr.cvExport.docx);

    expect(pdf.name).toBe("CV-Zoë-Łukasz-Øster-Ğül.pdf");
    expect(docx.name).toBe("CV-Zoë-Łukasz-Øster-Ğül.docx");
    expect(pdf.text).toContain("Zoë Łukasz-Øster Ğül Ingénieure ≥ senior → lead 🚀 marie.dupont@example.fr · 06 12 34 56 78 · Kraków / Москва");
    expect(pdf.text).toContain("李明 · 김민준 · Ελληνικά ✓");
    expect(pdf.text).toBe(docx.text);
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

  // Acceptance criteria: 2–3 minimal templates, single column, nothing that
  // breaks ATS parsing (images, tables, text boxes, headers/footers, columns),
  // and the PDF and Word file of each template say the same thing.
  for (const template of ["classic", "modern", "compact"]) {
    test(`the ${template} CV Template is ATS-safe and says the same thing in PDF and Word`, async ({ page }) => {
      const id = await candidateWithProfile(page, `export-ats-${template}`);
      const fetchFile = async (format: string) => {
        const response = await page.request.get(`/api/profiles/${id}/master-cv/export?format=${format}&template=${template}`);
        expect(response.status()).toBe(200);
        return Buffer.from(await response.body());
      };
      const pdf = await fetchFile("pdf");
      const docx = await fetchFile("docx");

      expect(await textOf("cv.pdf", pdf)).toBe(expectedText);
      expect(await textOf("cv.docx", docx)).toBe(expectedText);

      // PDF: real text in standard (unembedded) fonts, no images, one column.
      const raw = pdf.toString("latin1");
      expect(raw).not.toMatch(/\/Subtype\s*\/Image/);
      expect(raw).not.toMatch(/\/FontFile[23]?\b/);
      const proxy = await getDocumentProxy(new Uint8Array(pdf));
      expect(proxy.numPages).toBe(1);
      const content = await (await proxy.getPage(1)).getTextContent();
      const runs = (content.items as { str: string; transform: number[]; width: number }[])
        .filter((item) => item.str.trim() !== "")
        .map((item) => ({ x: item.transform[4], y: Math.round(item.transform[5]), right: item.transform[4] + item.width }));
      const lines = new Map<number, typeof runs>();
      for (const run of runs) lines.set(run.y, [...(lines.get(run.y) ?? []), run]);
      for (const line of lines.values()) {
        // Text on one baseline is one continuous run: no second column beside it.
        const sorted = [...line].sort((a, b) => a.x - b.x);
        for (let i = 1; i < sorted.length; i++) expect(sorted[i].x - sorted[i - 1].right).toBeLessThan(15);
      }
      // Lines read top to bottom in the order of the content (one reading flow).
      const order = runs.map((run) => run.y);
      for (let i = 1; i < order.length; i++) expect(order[i]).toBeLessThanOrEqual(order[i - 1]);

      // Word: one section, one column, plain paragraphs only.
      const zip = await JSZip.loadAsync(docx);
      const parts = Object.keys(zip.files);
      expect(parts.filter((part) => /^word\/(media\/|header\d*\.xml|footer\d*\.xml)/.test(part))).toEqual([]);
      const xml = await zip.file("word/document.xml")!.async("string");
      for (const forbidden of ["<w:tbl>", "<w:tbl ", "<w:drawing", "<w:pict", "<w:txbxContent", "<w:framePr", "<v:shape", "<w:object"]) {
        expect(xml, `${template} DOCX contains ${forbidden}`).not.toContain(forbidden);
      }
      for (const cols of xml.match(/<w:cols\b[^>]*>/g) ?? []) expect(cols).not.toMatch(/w:num="([2-9]|\d{2,})"/);
      expect(xml.match(/<w:sectPr\b/g)?.length).toBe(1);
    });
  }
});
