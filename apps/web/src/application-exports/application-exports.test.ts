import type { MasterCvContent } from "@jobhub/shared";
import mammoth from "mammoth";
import { describe, expect, it } from "vitest";
import type { Application } from "../applications";
import type { Profile } from "../profiles";
import type { ApplicationTailoredCv } from "../tailored-cv";
import type { ApplicationDrafts } from "../tailored-documents";
import { createApplicationExports, type ApplicationExportsDeps } from "./index";

const masterCv: MasterCvContent = {
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

const tailored: MasterCvContent = {
  ...masterCv,
  headline: "Chief Financial Officer",
  summary: "25 years in industry.",
  experience: [{ title: "Chief Financial Officer", employer: "Groupe Seb", location: "Lyon", period: "2015 – 2024", description: "Financial management." }],
  education: [{ degree: "Master's in Finance", institution: "ESSEC", year: "1998" }],
  languages: [{ name: "English", level: "fluent" }],
};

const application = {
  id: "a1",
  jobOffer: { id: "o1", title: "CFO", employer: "Globex Ltd" },
  profile: { id: "p1", name: "DAF" },
} as Application;

const profile = { id: "p1", name: "DAF", archived: false, masterCv: { version: 1, content: masterCv } } as Profile;

const savedCv: ApplicationTailoredCv = {
  documentLanguage: "en",
  proposal: null,
  saved: { language: "en", masterCvVersion: 1, content: tailored, matchScore: { master: 60, tailored: 80 }, savedAt: new Date() },
};

const letterText = "Dear Sir or Madam,\n\nI am applying for the CFO position.\n\nYours faithfully,";
const drafts: ApplicationDrafts = {
  documentLanguage: "en",
  coverLetter: { language: "en", text: letterText, draftedAt: new Date(), updatedAt: new Date(), provenance: null },
  outreachMessage: null,
};

/** The Candidate "c1" owns Application "a1"; nobody else sees it. */
function exportsWith(overrides: { tailoredCv?: ApplicationTailoredCv; drafts?: ApplicationDrafts } = {}) {
  const own = <T>(value: T) => async (candidateId: string, id: string) => (candidateId === "c1" && ["a1", "p1"].includes(id) ? value : null);
  const deps: ApplicationExportsDeps = {
    applications: { get: own(application) },
    profiles: { get: own(profile) },
    tailoredCvs: { get: own(overrides.tailoredCv ?? savedCv) },
    tailoredDocuments: { get: own(overrides.drafts ?? drafts) },
    now: () => new Date("2026-10-07T09:30:00Z"),
  };
  return createApplicationExports(deps);
}

const pdfWordsOf = async (bytes: Uint8Array) => {
  const { extractText, getDocumentProxy } = await import("unpdf");
  return (await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: true })).text.replace(/\s+/g, " ").trim();
};
const wordsOf = async (bytes: Uint8Array) => (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value.replace(/\s+/g, " ").trim();

describe("exporting an Application's saved documents", () => {
  it("exports the saved Tailored CV in its Document Language, named after the Candidate and the employer", async () => {
    const file = await exportsWith().file("c1", "a1", "tailored_cv", { format: "docx", template: "modern" });

    expect(file?.fileName).toBe("CV-Marie-Dupont-Globex-Ltd.docx");
    expect(file?.contentType).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(await wordsOf(file!.bytes)).toBe(
      "Marie Dupont Chief Financial Officer marie.dupont@example.fr · 06 12 34 56 78 · Lyon " +
        "Profile 25 years in industry. " +
        "Professional experience Chief Financial Officer — Groupe Seb, Lyon — 2015 – 2024 Financial management. " +
        "Education Master's in Finance — ESSEC — 1998 " +
        "Skills IFRS · SAP " +
        "Languages English: fluent",
    );
  });

  it("exports the Cover Letter with the Master CV's contact details, addressed to the employer and dated the day of the export", async () => {
    const file = await exportsWith().file("c1", "a1", "cover_letter", { format: "docx", template: "classic" });

    expect(file?.fileName).toBe("Cover-letter-Marie-Dupont-Globex-Ltd.docx");
    expect(await wordsOf(file!.bytes)).toBe(
      "Marie Dupont marie.dupont@example.fr · 06 12 34 56 78 · Lyon Globex Ltd Lyon, 7 October 2026 " +
        "Dear Sir or Madam, I am applying for the CFO position. Yours faithfully, Marie Dupont",
    );
  });

  it("exports a Cover Letter drafted with its own header, Markdown and placeholders as its plain body, framed once by the export's sender block and signature (#162)", async () => {
    const text =
      "**Marie Dupont**\n[Adresse]\n[Code postal, Ville]\n[Email] | [Téléphone]\n\nLyon, le [Date]\n\n**Objet : Candidature au poste de DAF**\n\n" +
      "Madame, Monsieur,\n\nJ'ai piloté la **consolidation IFRS** d'un groupe industriel.\n\nJe vous prie d'agréer mes salutations distinguées.\n\n**Marie Dupont**";
    const french = exportsWith({ drafts: { ...drafts, coverLetter: { language: "fr", text, draftedAt: new Date(), updatedAt: new Date(), provenance: null } } });

    for (const format of ["docx", "pdf"] as const) {
      const file = await french.file("c1", "a1", "cover_letter", { format, template: "classic" });
      const words = format === "docx" ? await wordsOf(file!.bytes) : await pdfWordsOf(file!.bytes);
      expect(words, format).toBe(
        "Marie Dupont marie.dupont@example.fr · 06 12 34 56 78 · Lyon Globex Ltd Lyon, le 7 octobre 2026 " +
          "Madame, Monsieur, J'ai piloté la consolidation IFRS d'un groupe industriel. Je vous prie d'agréer mes salutations distinguées. Marie Dupont",
      );
    }
  });

  it("exports a PDF too", async () => {
    const file = await exportsWith().file("c1", "a1", "cover_letter", { format: "pdf", template: "compact" });

    expect(file?.contentType).toBe("application/pdf");
    expect(file?.bytes.length).toBeGreaterThan(0);
  });

  it("exports nothing of another Candidate's Application", async () => {
    expect(await exportsWith().file("c2", "a1", "tailored_cv", { format: "pdf", template: "classic" })).toBeNull();
    expect(await exportsWith().file("c2", "a1", "cover_letter", { format: "pdf", template: "classic" })).toBeNull();
  });

  it("exports nothing before the document is saved, not even a proposal under review", async () => {
    const unsaved = exportsWith({
      tailoredCv: { ...savedCv, saved: null, proposal: { ...savedCv.saved!, revision: "r1", questions: [], changes: [], offerWordingTranslated: false, proposedAt: new Date() } },
      drafts: { ...drafts, coverLetter: null },
    });

    expect(await unsaved.file("c1", "a1", "tailored_cv", { format: "pdf", template: "classic" })).toBeNull();
    expect(await unsaved.file("c1", "a1", "cover_letter", { format: "pdf", template: "classic" })).toBeNull();
  });
});
