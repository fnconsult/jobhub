/**
 * Exporting a CV (Master or Tailored) or a Cover Letter as a PDF or Word (.docx)
 * file, laid out with one of the CV Templates.
 *
 * One deep module. Callers get `exportDocument(document, { format, template, language })`
 * and a ready-to-download file. Both formats render the same lines of text
 * (see `layout.ts`), so a PDF and a DOCX of one document always say the same
 * thing; the template only changes how it looks. Nothing is read from or saved
 * to the database here.
 */
import type { MasterCvContent } from "@jobhub/shared";
import { createI18n, type Locale } from "@jobhub/shared/i18n";
import { renderDocx } from "./docx";
import { layout } from "./layout";
import { renderPdf } from "./pdf";
import { TEMPLATE_STYLES } from "./templates";

import { CV_TEMPLATES, EXPORT_FORMATS, type CvTemplate, type ExportFormat } from "./kinds";

export { CV_TEMPLATES, EXPORT_FORMATS, type CvTemplate, type ExportFormat } from "./kinds";

/** What a Cover Letter says, as the Candidate would sign it. Empty strings are left out. */
export interface CoverLetterContent {
  /** The Candidate, as they sign. */
  fullName: string;
  email: string;
  phone: string;
  location: string;
  /** Who the letter is addressed to, one line per line of the address. */
  recipient: string;
  /** Place and date, as written (e.g. "Lyon, le 7 octobre 2026"). */
  date: string;
  subject: string;
  /** The letter itself: paragraphs separated by blank lines. */
  body: string;
}

/** A Master CV or a Tailored CV (both have the content of a Master CV), or a Cover Letter. */
export type ExportableDocument =
  | { kind: "cv"; content: MasterCvContent }
  | { kind: "cover_letter"; content: CoverLetterContent };

export interface ExportOptions {
  format: ExportFormat;
  template: CvTemplate;
  /** The Document Language: section headings and the file name are written in it. */
  language: Locale;
  /** The employer a Tailored CV or a Cover Letter is for: named in the file name after the Candidate. */
  employer?: string;
}

export interface ExportedFile {
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
}

export const CONTENT_TYPES: Record<ExportFormat, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export function isCvTemplate(value: unknown): value is CvTemplate {
  return typeof value === "string" && (CV_TEMPLATES as readonly string[]).includes(value);
}

export function isExportFormat(value: unknown): value is ExportFormat {
  return typeof value === "string" && (EXPORT_FORMATS as readonly string[]).includes(value);
}

/**
 * "CV-Marie-Dupont.pdf", "CV-Zoë-Łukasz.pdf", "CV-李明.pdf", "CV-राहुल-शर्मा.pdf": letters (with their vowel signs and accents) and digits of any script, joined by dashes.
 * With the employer after the Candidate's name: "Lettre-de-motivation-Marie-Dupont-Groupe-Danone.pdf".
 */
function fileNameOf(document: ExportableDocument, { format, language, employer = "" }: ExportOptions): string {
  const { t } = createI18n(language);
  const prefix = t(document.kind === "cv" ? "cvDocument.cvFileName" : "cvDocument.coverLetterFileName");
  return `${slug([prefix, document.content.fullName, employer].join(" "), /[^\p{L}\p{M}\p{N}]+/gu)}.${format}`;
}

const slug = (text: string, unwanted: RegExp) =>
  text
    .normalize("NFC")
    .replace(unwanted, "-")
    .replace(/^-+|-+$/g, "");

/** Latin letters that are not a base letter plus an accent, so NFD cannot strip them. */
const ASCII_LETTERS: Record<string, string> = {
  Ł: "L", ł: "l", Ø: "O", ø: "o", Đ: "D", đ: "d", Ð: "D", ð: "d", Þ: "Th", þ: "th", ß: "ss",
  Æ: "AE", æ: "ae", Œ: "OE", œ: "oe", ı: "i", Ħ: "H", ħ: "h", Ŋ: "N", ŋ: "n", Ŧ: "T", ŧ: "t",
};

/**
 * The Content-Disposition header that downloads a file under `fileName`. HTTP
 * headers are ASCII, so a name with other letters goes in `filename*` (RFC
 * 6266), with a transliterated `filename` for older browsers.
 */
export function contentDisposition(fileName: string): string {
  if (/^[ -~]*$/.test(fileName)) return `attachment; filename="${fileName}"`;
  const dot = fileName.lastIndexOf(".");
  const ascii = slug(
    fileName
      .slice(0, dot)
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[^ -~]/g, (letter) => ASCII_LETTERS[letter] ?? "-"),
    /[^A-Za-z0-9]+/g,
  );
  return `attachment; filename="${ascii || "download"}${fileName.slice(dot)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function exportDocument(document: ExportableDocument, options: ExportOptions): Promise<ExportedFile> {
  const blocks = layout(document, options.language);
  const style = TEMPLATE_STYLES[options.template];
  const fileName = fileNameOf(document, options);
  const render = options.format === "pdf" ? renderPdf : renderDocx;
  const bytes = await render(blocks, style, fileName);
  return { fileName, contentType: CONTENT_TYPES[options.format], bytes };
}
