/**
 * What an exported document says, line by line, before any CV Template styles
 * it. Both file formats render these blocks, so a PDF and a DOCX of the same
 * document always carry the same text.
 *
 * Lines are written the way Jobbbox's own CV reader (and ATS parsers) expect:
 * known section headings, one entry per line, separators between fields.
 */
import type { MasterCvContent } from "@jobhub/shared";
import { createI18n, type Locale } from "@jobhub/shared/i18n";
import type { CoverLetterContent, ExportableDocument } from "./index";

export type Block =
  | { kind: "name"; text: string }
  | { kind: "headline"; text: string }
  | { kind: "contact"; text: string }
  | { kind: "heading"; text: string }
  /** The first line of an entry (a job, a diploma): shown in bold. */
  | { kind: "entry"; text: string }
  | { kind: "text"; text: string }
  /** Ends a group of lines (a recipient's address, a letter's paragraph): the next block starts after a gap. */
  | { kind: "gap" };

const joined = (separator: string, parts: string[]) => parts.filter(Boolean).join(separator);
const linesOf = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

function cvBlocks(cv: MasterCvContent, language: Locale): Block[] {
  const { t } = createI18n(language);
  const blocks: Block[] = [];
  const add = (kind: "name" | "headline" | "contact" | "heading" | "entry" | "text", text: string) => {
    if (text) blocks.push({ kind, text });
  };
  const section = (heading: string, items: unknown[], body: () => void) => {
    if (items.length === 0) return;
    add("heading", heading);
    body();
  };

  add("name", cv.fullName);
  add("headline", cv.headline);
  add("contact", joined(" · ", [cv.email, cv.phone, cv.location]));
  section(t("cvDocument.summary"), linesOf(cv.summary), () => linesOf(cv.summary).forEach((line) => add("text", line)));
  section(t("cvDocument.experience"), cv.experience, () => {
    for (const job of cv.experience) {
      add("entry", joined(" — ", [job.title, joined(", ", [job.employer, job.location]), job.period]));
      linesOf(job.description).forEach((line) => add("text", line));
    }
  });
  section(t("cvDocument.education"), cv.education, () => {
    for (const item of cv.education) add("entry", joined(" — ", [item.degree, item.institution, item.year]));
  });
  section(t("cvDocument.skills"), cv.skills, () => add("text", cv.skills.join(" · ")));
  section(t("cvDocument.languages"), cv.languages, () => {
    for (const { name, level } of cv.languages) add("text", name && level ? t("cvDocument.languageLevel", { name, level }) : name || level);
  });
  return blocks;
}

/** A French-style letter: sender, recipient, place and date, subject, paragraphs, signature. */
function letterBlocks(letter: CoverLetterContent, language: Locale): Block[] {
  const { t } = createI18n(language);
  const blocks: Block[] = [];
  const add = (kind: "name" | "contact" | "text", text: string) => {
    if (text) blocks.push({ kind, text });
  };
  const group = (lines: string[]) => {
    if (lines.length === 0) return;
    lines.forEach((line) => add("text", line));
    blocks.push({ kind: "gap" });
  };

  add("name", letter.fullName);
  add("contact", joined(" · ", [letter.email, letter.phone, letter.location]));
  blocks.push({ kind: "gap" });
  group(linesOf(letter.recipient));
  group(linesOf(letter.date));
  if (letter.subject.trim()) {
    blocks.push({ kind: "entry", text: t("cvDocument.subject", { subject: letter.subject.trim() }) }, { kind: "gap" });
  }
  for (const paragraph of letter.body.split(/\n\s*\n/)) group(linesOf(paragraph));
  add("text", letter.fullName);
  return blocks;
}

/** The blocks of `document`, with headings in `language` (its Document Language). */
export function layout(document: ExportableDocument, language: Locale): Block[] {
  return document.kind === "cv" ? cvBlocks(document.content, language) : letterBlocks(document.content, language);
}
