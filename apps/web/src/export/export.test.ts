import { createAiLayer } from "@jobhub/ai";
import { createFakeProvider, createMemoryUsageLog } from "@jobhub/ai/testing";
import type { MasterCvContent } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { draftFromCv } from "../cv";
import { exportDocument } from "./index";

const marie: MasterCvContent = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "06 12 34 56 78",
  location: "Lyon",
  summary: "Directrice financière, 25 ans d'expérience dans l'industrie.",
  experience: [
    {
      title: "Directrice financière",
      employer: "Groupe Seb",
      location: "Lyon",
      period: "2015 – 2024",
      description: "Pilotage financier d'un groupe de 2 000 personnes.",
    },
    { title: "Responsable du contrôle de gestion", employer: "Renault", location: "Paris", period: "2005 – 2015", description: "" },
  ],
  education: [{ degree: "Master Finance", institution: "ESSEC", year: "1998" }],
  skills: ["Consolidation", "IFRS", "SAP", "Management d'équipe"],
  languages: [
    { name: "Anglais", level: "courant" },
    { name: "Allemand", level: "notions" },
  ],
};

/** Reads an exported file back the way Jobbbox reads an uploaded CV, without the AI Coach: a stand-in for an ATS parser. */
async function readBack(file: { fileName: string; bytes: Uint8Array }): Promise<MasterCvContent> {
  const ai = createAiLayer({
    providers: [createFakeProvider({ reply: "illisible" })],
    routes: { cv_parsing: "anthropic" },
    usage: createMemoryUsageLog(),
  });
  return (await draftFromCv({ name: file.fileName, bytes: file.bytes }, { ai, candidateId: "c1" })).masterCv;
}

describe("exporting a CV", () => {
  it("writes a DOCX that reads back into the same Master CV", async () => {
    const file = await exportDocument({ kind: "cv", content: marie }, { format: "docx", template: "classic", language: "fr" });

    expect(file.contentType).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(file.fileName).toBe("CV-Marie-Dupont.docx");
    expect(await readBack(file)).toEqual(marie);
  });

  it("writes a PDF that reads back into the same Master CV", async () => {
    const file = await exportDocument({ kind: "cv", content: marie }, { format: "pdf", template: "classic", language: "fr" });

    expect(file.contentType).toBe("application/pdf");
    expect(file.fileName).toBe("CV-Marie-Dupont.pdf");
    expect(await readBack(file)).toEqual(marie);
  });
});
