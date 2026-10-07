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
import { TEMPLATE_STYLES } from "./templates";

/** The CV Templates, all ATS-safe. The first one is the default. */
export const CV_TEMPLATES = ["classic", "modern", "compact"] as const;
export type CvTemplate = (typeof CV_TEMPLATES)[number];

export const EXPORT_FORMATS = ["pdf", "docx"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

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

/** "CV-Marie-Dupont.pdf": safe in any file system and in a Content-Disposition header. */
function fileNameOf(document: ExportableDocument, { format, language }: ExportOptions): string {
  const { t } = createI18n(language);
  const prefix = t(document.kind === "cv" ? "cvDocument.cvFileName" : "cvDocument.coverLetterFileName");
  const name = document.content.fullName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${[prefix, name].filter(Boolean).join("-")}.${format}`;
}

export async function exportDocument(document: ExportableDocument, options: ExportOptions): Promise<ExportedFile> {
  const blocks = layout(document, options.language);
  const style = TEMPLATE_STYLES[options.template];
  const fileName = fileNameOf(document, options);
  const bytes = await renderDocx(blocks, style, fileName);
  return { fileName, contentType: CONTENT_TYPES[options.format], bytes };
}
