import { createAiLayer, type AiLayer } from "@jobhub/ai";
import { createFakeProvider, createMemoryUsageLog, type FakeProvider } from "@jobhub/ai/testing";
import { describe, expect, it } from "vitest";
import { draftFromCv } from "./index";
import { CvFileError } from "./index";
import { PROFILE_NAME_MAX_LENGTH } from "../profiles/limits";
import { docxCv, MARIE_DUPONT_CV, pdfCv } from "./test-support";

function aiReplying(reply: string): { ai: AiLayer; provider: FakeProvider } {
  const provider = createFakeProvider({ reply });
  const ai = createAiLayer({ providers: [provider], routes: { cv_parsing: "anthropic" }, usage: createMemoryUsageLog() });
  return { ai, provider };
}

describe("drafting a Master CV and Search Criteria from an uploaded CV", () => {
  it("reads a PDF CV into sections when the AI reply is unusable", async () => {
    const { ai } = aiReplying("désolé, je ne peux pas");

    const draft = await draftFromCv({ name: "cv.pdf", bytes: pdfCv(MARIE_DUPONT_CV) }, { ai, candidateId: "c1" });

    expect(draft.masterCv).toMatchObject({
      fullName: "Marie Dupont",
      headline: "Directrice financière",
      email: "marie.dupont@example.fr",
      phone: "06 12 34 56 78",
      location: "Lyon (69003)",
      summary: "Directrice financière, 25 ans d'expérience dans l'industrie.",
      experience: [
        {
          title: "Directrice financière",
          employer: "Groupe Seb",
          location: "Lyon",
          period: "2015 – 2024",
          description: "Pilotage financier d'un groupe de 2 000 personnes.",
        },
        {
          title: "Responsable du contrôle de gestion",
          employer: "Renault",
          location: "Paris",
          period: "2005 – 2015",
          description: "Mise en place du reporting mensuel.",
        },
      ],
      education: [{ degree: "Master Finance", institution: "ESSEC", year: "1998" }],
      skills: ["Consolidation", "IFRS", "SAP", "Management d'équipe"],
      languages: [
        { name: "Anglais", level: "courant" },
        { name: "Allemand", level: "notions" },
      ],
    });
    expect(draft.searchCriteria).toEqual({ targetRole: "Directrice financière", location: "Lyon (69003)" });
  });

  it("reads a period in brackets, a town on the contact line and an unrecognised last section", async () => {
    const { ai } = aiReplying("désolé, je ne peux pas");
    const lines = [
      "Jean Martin",
      "Chef de projet SI",
      "jean.martin@example.fr · 06 98 76 54 32 · Nantes",
      "Expérience professionnelle",
      "Chef de projet SI — Airbus, Nantes (2018 – 2024)",
      "Formation",
      "Ingénieur informatique — INSA Rennes (2010)",
      "Langues",
      "Anglais : courant",
      "Divers",
      "Voile, course à pied",
    ];

    const draft = await draftFromCv({ name: "cv.pdf", bytes: pdfCv(lines) }, { ai, candidateId: "c1" });

    expect(draft.masterCv).toMatchObject({
      location: "Nantes",
      experience: [{ title: "Chef de projet SI", employer: "Airbus", location: "Nantes", period: "2018 – 2024", description: "" }],
      education: [{ degree: "Ingénieur informatique", institution: "INSA Rennes", year: "2010" }],
      languages: [{ name: "Anglais", level: "courant" }],
    });
    expect(draft.searchCriteria).toEqual({ targetRole: "Chef de projet SI", location: "Nantes" });
  });

  it("reads a Word (.docx) CV the same way as a PDF", async () => {
    const { ai } = aiReplying("pas du JSON");
    const fromPdf = await draftFromCv({ name: "cv.pdf", bytes: pdfCv(MARIE_DUPONT_CV) }, { ai, candidateId: "c1" });

    const fromDocx = await draftFromCv({ name: "Mon CV.DOCX", bytes: await docxCv(MARIE_DUPONT_CV) }, { ai, candidateId: "c1" });

    expect(fromDocx).toEqual(fromPdf);
  });

  it.each([
    ["an old Word .doc file", "cv.doc", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3])],
    ["an image", "cv.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47])],
    ["a text file renamed .pdf", "cv.pdf", new TextEncoder().encode("Marie Dupont")],
  ])("refuses %s as an unsupported format", async (_, name, bytes) => {
    const { ai, provider } = aiReplying("{}");

    const drafting = draftFromCv({ name, bytes }, { ai, candidateId: "c1" });

    await expect(drafting).rejects.toThrow(CvFileError);
    await expect(drafting).rejects.toMatchObject({ code: "unsupported_format" });
    expect(provider.calls).toHaveLength(0);
  });

  it("refuses a damaged PDF as unreadable", async () => {
    const { ai } = aiReplying("{}");
    const damaged = pdfCv(MARIE_DUPONT_CV).slice(0, 40);

    await expect(draftFromCv({ name: "cv.pdf", bytes: damaged }, { ai, candidateId: "c1" })).rejects.toMatchObject({ code: "unreadable" });
  });

  it("refuses a PDF with no text (a scanned CV) as empty", async () => {
    const { ai } = aiReplying("{}");

    await expect(draftFromCv({ name: "scan.pdf", bytes: pdfCv([]) }, { ai, candidateId: "c1" })).rejects.toMatchObject({ code: "empty" });
  });

  it("refuses a file over 10 MB", async () => {
    const { ai } = aiReplying("{}");
    const huge = new Uint8Array(10 * 1024 * 1024 + 1);
    huge.set([0x25, 0x50, 0x44, 0x46]);

    await expect(draftFromCv({ name: "cv.pdf", bytes: huge }, { ai, candidateId: "c1" })).rejects.toMatchObject({ code: "too_large" });
  });

  describe("read by the AI Coach", () => {
    const aiReading = {
      masterCv: {
        fullName: "Marie Dupont",
        headline: "Directrice financière",
        email: "marie.dupont@example.fr",
        phone: "06 12 34 56 78",
        location: "Lyon",
        summary: "25 ans d'expérience.",
        experience: [{ title: "DAF", employer: "Groupe Seb", location: "Lyon", period: "2015 – 2024", description: "Pilotage." }],
        education: [{ degree: "Master Finance", institution: "ESSEC", year: "1998" }],
        skills: ["IFRS"],
        languages: [{ name: "Anglais", level: "courant" }],
      },
      searchCriteria: { targetRole: "Directrice administrative et financière", location: "Lyon" },
    };

    it("uses the AI Coach's reading of the CV, sent through the cv_parsing task for the Candidate", async () => {
      const { ai, provider } = aiReplying(JSON.stringify(aiReading));

      const draft = await draftFromCv({ name: "cv.pdf", bytes: pdfCv(MARIE_DUPONT_CV) }, { ai, candidateId: "cand-42" });

      expect(draft).toEqual(aiReading);
      expect(provider.calls).toHaveLength(1);
      expect(provider.calls[0]!.messages.at(-1)!.content).toContain("Responsable du contrôle de gestion — Renault, Paris — 2005 – 2015");
    });

    it("shortens a target role too long to name a Profile, at a word boundary", async () => {
      const longRole = `${"Responsable ".repeat(12)}financier`;
      const { ai } = aiReplying(JSON.stringify({ ...aiReading, searchCriteria: { targetRole: longRole, location: "Lyon" } }));

      const draft = await draftFromCv({ name: "cv.pdf", bytes: pdfCv(MARIE_DUPONT_CV) }, { ai, candidateId: "c1" });

      expect(draft.searchCriteria.targetRole.length).toBeLessThanOrEqual(PROFILE_NAME_MAX_LENGTH);
      expect(draft.searchCriteria.targetRole).toBe("Responsable ".repeat(10).trim());
    });

    it("accepts a reading wrapped in a Markdown code block, and fills what it leaves out with empty fields", async () => {
      const { ai } = aiReplying('Voici le CV :\n```json\n{"masterCv": {"fullName": "Marie Dupont", "skills": ["IFRS", 3]}}\n```');

      const draft = await draftFromCv({ name: "cv.pdf", bytes: pdfCv(MARIE_DUPONT_CV) }, { ai, candidateId: "c1" });

      expect(draft).toEqual({
        masterCv: {
          fullName: "Marie Dupont",
          headline: "",
          email: "",
          phone: "",
          location: "",
          summary: "",
          experience: [],
          education: [],
          skills: ["IFRS"],
          languages: [],
        },
        searchCriteria: { targetRole: "", location: "" },
      });
    });

    it("falls back to the rule-based reading when the AI provider fails", async () => {
      const provider = createFakeProvider();
      provider.generate = async () => {
        throw new Error("provider down");
      };
      const ai = createAiLayer({ providers: [provider], routes: { cv_parsing: "anthropic" }, usage: createMemoryUsageLog() });

      const draft = await draftFromCv({ name: "cv.pdf", bytes: pdfCv(MARIE_DUPONT_CV) }, { ai, candidateId: "c1" });

      expect(draft.masterCv.fullName).toBe("Marie Dupont");
      expect(draft.masterCv.experience).toHaveLength(2);
    });
  });
});
