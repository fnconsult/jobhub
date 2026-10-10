import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAiLayer } from "@jobhub/ai";
import JSZip from "jszip";
import { createFakeProvider, createMemoryUsageLog } from "@jobhub/ai/testing";
import type { MasterCvContent } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { draftFromCv } from "../cv";
import { allFontFiles, findFontFile, fontBytes, visualOrder } from "./fonts";
import { logicalReading } from "./logical-text";
import { contentDisposition, CV_TEMPLATES, EXPORT_FORMATS, exportDocument, type CoverLetterContent } from "./index";

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
  return (await draftFromCv({ name: file.fileName, bytes: file.bytes }, { ai: () => ai, candidateId: "c1" })).masterCv;
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

  describe.each(CV_TEMPLATES)("with the %s CV Template", (template) => {
    it.each(EXPORT_FORMATS)("writes a %s that reads back into the same Master CV", async (format) => {
      const file = await exportDocument({ kind: "cv", content: marie }, { format, template, language: "fr" });

      expect(await readBack(file)).toEqual(marie);
    });

    it("writes a DOCX in one column of plain paragraphs: no tables, images, text boxes, headers or footers", async () => {
      const file = await exportDocument({ kind: "cv", content: marie }, { format: "docx", template, language: "fr" });
      const zip = await JSZip.loadAsync(file.bytes);
      const body = await zip.file("word/document.xml")!.async("string");

      expect(body).not.toMatch(/<w:tbl\b|<w:drawing\b|<w:pict\b|<w:txbxContent\b|<w:headerReference\b|<w:footerReference\b/);
      expect(body).not.toMatch(/<w:cols [^>]*w:num="([2-9]|\d\d)"/);
      expect(Object.keys(zip.files).filter((path) => /^word\/(media|header|footer)/.test(path))).toEqual([]);
    });

    it("writes a PDF of text only, in standard fonts that are not embedded", async () => {
      const file = await exportDocument({ kind: "cv", content: marie }, { format: "pdf", template, language: "fr" });
      const pdf = Buffer.from(file.bytes).toString("latin1");

      expect(pdf).not.toMatch(/\/Subtype\s*\/Image/);
      expect(pdf).not.toMatch(/\/FontFile/);
    });
  });
});

it("writes the template's section headings in the Document Language", async () => {
  const file = await exportDocument({ kind: "cv", content: marie }, { format: "docx", template: "modern", language: "en" });

  expect(file.fileName).toBe("CV-Marie-Dupont.docx");
  const body = await (await JSZip.loadAsync(file.bytes)).file("word/document.xml")!.async("string");
  expect(body).toContain("Professional experience");
  expect(body).not.toContain("Expérience professionnelle");
});

/** The words of an exported file, in order, as a text extractor sees them (line breaks and wrapping ignored). */
async function wordsOf(file: { fileName: string; bytes: Uint8Array }): Promise<string> {
  let text: string;
  if (file.fileName.endsWith(".pdf")) {
    const { extractText, getDocumentProxy } = await import("unpdf");
    text = (await extractText(await getDocumentProxy(new Uint8Array(file.bytes)), { mergePages: true })).text;
  } else {
    const mammoth = await import("mammoth");
    text = (await mammoth.extractRawText({ buffer: Buffer.from(file.bytes) })).value;
  }
  return text.replace(/\s+/g, " ").trim();
}

describe("exporting a Cover Letter", () => {
  const letter: CoverLetterContent = {
    fullName: "Marie Dupont",
    email: "marie.dupont@example.fr",
    phone: "06 12 34 56 78",
    location: "Lyon",
    recipient: "Groupe Danone\nDirection des ressources humaines\n17 boulevard Haussmann, 75009 Paris",
    date: "Lyon, le 7 octobre 2026",
    subject: "Candidature au poste de Directrice administrative et financière",
    body:
      "Madame, Monsieur,\n\n" +
      "Directrice financière depuis quinze ans dans l'industrie, j'ai piloté la consolidation et le passage aux normes IFRS d'un groupe de 2 000 personnes. Votre offre m'a d'emblée retenue.\n\n" +
      "Je serais heureuse de vous exposer ma démarche lors d'un entretien.\n\n" +
      "Je vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.",
  };
  const expected =
    "Marie Dupont marie.dupont@example.fr · 06 12 34 56 78 · Lyon " +
    "Groupe Danone Direction des ressources humaines 17 boulevard Haussmann, 75009 Paris " +
    "Lyon, le 7 octobre 2026 " +
    "Objet : Candidature au poste de Directrice administrative et financière " +
    "Madame, Monsieur, " +
    "Directrice financière depuis quinze ans dans l'industrie, j'ai piloté la consolidation et le passage aux normes IFRS d'un groupe de 2 000 personnes. Votre offre m'a d'emblée retenue. " +
    "Je serais heureuse de vous exposer ma démarche lors d'un entretien. " +
    "Je vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées. " +
    "Marie Dupont";

  it.each(CV_TEMPLATES)("writes the same letter as a PDF and as a DOCX with the %s CV Template", async (template) => {
    const pdf = await exportDocument({ kind: "cover_letter", content: letter }, { format: "pdf", template, language: "fr" });
    const docx = await exportDocument({ kind: "cover_letter", content: letter }, { format: "docx", template, language: "fr" });

    expect(pdf.fileName).toBe("Lettre-de-motivation-Marie-Dupont.pdf");
    expect(docx.fileName).toBe("Lettre-de-motivation-Marie-Dupont.docx");
    expect(await wordsOf(pdf)).toBe(expected);
    expect(await wordsOf(docx)).toBe(expected);
  });
});

describe("exporting text outside the standard PDF fonts (WinAnsi)", () => {
  const zoe: MasterCvContent = {
    fullName: "Zoë Łukasz-Øster Ğül",
    headline: "Ingénieure ≥ senior → lead 🚀",
    email: "zoe@example.pl",
    phone: "",
    location: "Kraków / Москва",
    summary: "Wałęsa, Ćosić, Dvořák, Œuvre — 李明 こんにちは 김민준",
    experience: [{ title: "Ingénieure", employer: "Žabka", location: "Praha", period: "2020 – 2024", description: "• Puce deux ✓ 👩‍💻 🇫🇷" }],
    education: [],
    skills: ["Ελληνικά", "Русский", "中文"],
    languages: [],
  };

  describe.each(CV_TEMPLATES)("with the %s CV Template", (template) => {
    it("writes the same words in the PDF as in the DOCX", async () => {
      const pdf = await exportDocument({ kind: "cv", content: zoe }, { format: "pdf", template, language: "fr" });
      const docx = await exportDocument({ kind: "cv", content: zoe }, { format: "docx", template, language: "fr" });

      expect(await wordsOf(pdf)).toBe(await wordsOf(docx));
      expect(await wordsOf(pdf)).toContain("Zoë Łukasz-Øster Ğül Ingénieure ≥ senior → lead 🚀");
    });
  });
});

describe("exporting names and symbols in any script", () => {
  const cvOf = (fullName: string): MasterCvContent => ({ ...marie, fullName, headline: fullName, summary: fullName });
  const names = [
    "結城 花子", // Han ideographs in a Noto Sans SC slice that fontkit could not inflate
    "馬場 健",
    "李明 ❤",
    "राहुल मेहता", // Devanagari
    "สมชาย ใจดี", // Thai
    "محمد علي", // Arabic, right to left
    "דוד כהן", // Hebrew, right to left
    "∞ ☐ ★",
    "محمد 2024 علي", // digits inside a right-to-left passage
    "Ali محمد علي Smith", // right to left inside left-to-right text
    "राहुल शर्मा", // a reph, drawn after the letters it precedes
    "विकास", // a vowel sign drawn before the consonant it follows
  ];

  describe.each(CV_TEMPLATES)("with the %s CV Template", (template) => {
    it.each(names)("writes %s in the PDF as in the DOCX", async (name) => {
      const pdf = await exportDocument({ kind: "cv", content: cvOf(name) }, { format: "pdf", template, language: "fr" });
      const docx = await exportDocument({ kind: "cv", content: cvOf(name) }, { format: "docx", template, language: "fr" });

      expect(await wordsOf(docx)).toContain(`${name} ${name}`);
      expect(await wordsOf(pdf)).toBe(await wordsOf(docx));
    });
  });

  it("puts the words of a right-to-left passage in the order they are seen", () => {
    expect(visualOrder("محمد علي")).toBe("علي محمد");
    expect(visualOrder("Marie محمد علي Dupont, דוד כהן")).toBe("Marie علي محمد Dupont, כהן דוד");
    expect(visualOrder("Marie Dupont")).toBe("Marie Dupont");
  });

  it("keeps the numbers of a right-to-left passage among its words, as the Unicode bidirectional algorithm does", () => {
    expect(visualOrder("محمد 2024 علي")).toBe("علي 2024 محمد");
    expect(visualOrder("محمد علي 2024")).toBe("2024 علي محمد");
    expect(visualOrder("محمد · 2024 Smith")).toBe("2024 · محمد Smith");
    expect(visualOrder("2024 محمد علي")).toBe("2024 علي محمد");
    expect(visualOrder("محمد علي · Smith")).toBe("علي محمد · Smith");
  });

  it("reads the glyphs of a cluster the font reorders in the order their letters are typed", () => {
    const codes = (text: string) => Array.from(text, (char) => char.codePointAt(0)!);
    // "शर्मा" is drawn श, म, ा, then the reph र्.
    const reading = logicalReading([codes("श"), codes("म"), codes("ा"), codes("र्")], "शर्मा");

    expect(reading[0]).toBeUndefined();
    expect(String.fromCodePoint(...reading.slice(1).flatMap((chars) => chars!))).toBe("र्मा");
    // Glyphs drawn in the order of their letters keep their own reading.
    expect(logicalReading([codes("र"), codes("ा"), codes("हु"), codes("ल")], "राहुल")).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("can read every font file a PDF may embed", () => {
    const unreadable = allFontFiles().filter((file) => {
      try {
        fontBytes(file);
        return false;
      } catch {
        return true;
      }
    });

    expect(unreadable).toEqual([]);
  });
});

describe("exporting text with tabs", () => {
  it.each(CV_TEMPLATES)("writes a tab as a space in the PDF and the DOCX with the %s CV Template", async (template) => {
    const content = { ...marie, fullName: "Marie\tDupont", summary: "Finance\tet\tcontrôle" };
    const pdf = await exportDocument({ kind: "cv", content }, { format: "pdf", template, language: "fr" });
    const docx = await exportDocument({ kind: "cv", content }, { format: "docx", template, language: "fr" });

    expect(await wordsOf(pdf)).toContain("Marie Dupont Directrice financière marie.dupont@example.fr · 06 12 34 56 78 · Lyon Profil Finance et contrôle");
    expect(await wordsOf(pdf)).toBe(await wordsOf(docx));
  });
});

describe("naming an exported file", () => {
  const cvOf = (fullName: string) => ({ kind: "cv" as const, content: { ...marie, fullName } });

  it("keeps every letter of the Candidate's name, in any script", async () => {
    const options = { format: "pdf", template: "classic", language: "fr" } as const;

    expect((await exportDocument(cvOf("Zoë Łukasz-Øster Ğül"), options)).fileName).toBe("CV-Zoë-Łukasz-Øster-Ğül.pdf");
    expect((await exportDocument(cvOf("李明"), options)).fileName).toBe("CV-李明.pdf");
    expect((await exportDocument(cvOf("Marie Dupont / RH"), options)).fileName).toBe("CV-Marie-Dupont-RH.pdf");
    expect((await exportDocument(cvOf("राहुल शर्मा"), options)).fileName).toBe("CV-राहुल-शर्मा.pdf");
  });

  it("names the employer of a Tailored CV or a Cover Letter after the Candidate", async () => {
    const options = { format: "docx", template: "classic", language: "fr", employer: "Groupe Danone / RH" } as const;

    expect((await exportDocument(cvOf("Marie Dupont"), options)).fileName).toBe("CV-Marie-Dupont-Groupe-Danone-RH.docx");
    expect((await exportDocument(cvOf("Marie Dupont"), { ...options, language: "en", employer: "" })).fileName).toBe("CV-Marie-Dupont.docx");
  });

  it("downloads under that name, with a plain ASCII name for older browsers", () => {
    expect(contentDisposition("CV-Marie-Dupont.pdf")).toBe('attachment; filename="CV-Marie-Dupont.pdf"');
    expect(contentDisposition("CV-Zoë-Łukasz-Øster-Ğül.pdf")).toBe(
      `attachment; filename="CV-Zoe-Lukasz-Oster-Gul.pdf"; filename*=UTF-8''${encodeURIComponent("CV-Zoë-Łukasz-Øster-Ğül.pdf")}`,
    );
    expect(contentDisposition("CV-李明.pdf")).toBe(`attachment; filename="CV.pdf"; filename*=UTF-8''${encodeURIComponent("CV-李明.pdf")}`);
  });
});

describe("finding the font files", () => {
  it("finds a font in a package traced without its package.json, as in the standalone build", () => {
    const root = mkdtempSync(path.join(tmpdir(), "fonts-"));
    const app = path.join(root, "apps", "web");
    mkdirSync(path.join(root, "node_modules", "dejavu-fonts-ttf", "ttf"), { recursive: true });
    mkdirSync(app, { recursive: true });
    writeFileSync(path.join(root, "node_modules", "dejavu-fonts-ttf", "ttf", "DejaVuSans.ttf"), "");

    expect(findFontFile("dejavu-fonts-ttf", "ttf/DejaVuSans.ttf", app)).toBe(path.join(root, "node_modules", "dejavu-fonts-ttf", "ttf", "DejaVuSans.ttf"));
    expect(() => findFontFile("dejavu-fonts-ttf", "ttf/DejaVuSerif.ttf", app)).toThrow(/not installed/);
  });
});
