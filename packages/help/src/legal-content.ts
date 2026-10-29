/**
 * Reads and checks the Legal Documents' Markdown files (`legal/<locale>/<id>/<version>.md`), and writes them as the
 * `legal-documents.generated.ts` module the app bundles. Node only (reads files): never imported by `index.ts`.
 *
 *   writeFileSync(legalDocumentsModulePath, renderLegalDocumentsModule(readLegalDocuments()));
 *
 * A Legal Document's file: front matter (`title`, `effective`), then its sections, each under a `##` heading: an
 * optional first « En bref » (« In short ») list, then the numbered sections, numbered by their order.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HelpContentError, parseFrontmatter } from "./content";
import { compareLegalVersions, isLegalDocumentId, LEGAL_DOCUMENTS, type LegalDocument } from "./legal";
import { HELP_LOCALES, type HelpLocale } from "./types";

export type LegalDocuments = Record<HelpLocale, LegalDocument[]>;

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** This package's own legal directory. */
export const legalDir = path.join(packageDir, "legal");

/** The module `index.ts` serves the Legal Documents from, written by `renderLegalDocumentsModule`. */
export const legalDocumentsModulePath = path.join(packageDir, "src", "legal-documents.generated.ts");

const SUMMARY_HEADINGS: Record<HelpLocale, string> = { fr: "En bref", en: "In short" };
const VERSION_FILE = /^(\d+(?:\.\d+)*)\.md$/;

/** The source of `legal-documents.generated.ts`: every version of every Legal Document, by document, newest first. */
export function renderLegalDocumentsModule(documents: LegalDocuments): string {
  return [
    "// Written by `npm run build -w @jobhub/help` from legal/<locale>/<id>/<version>.md: edit those, never this file.",
    'import type { LegalDocument } from "./legal";',
    'import type { HelpLocale } from "./types";',
    "",
    `export const LEGAL_DOCUMENT_VERSIONS: Record<HelpLocale, readonly LegalDocument[]> = ${JSON.stringify(documents, null, 2)};`,
    "",
  ].join("\n");
}

/** Reads every Legal Document of `dir` (default: this package's `legal/`). Throws `HelpContentError` listing every problem. */
export function readLegalDocuments(dir: string = legalDir): LegalDocuments {
  const problems: string[] = [];
  const files = Object.fromEntries(HELP_LOCALES.map((locale) => [locale, markdownFiles(path.join(dir, locale))])) as Record<HelpLocale, string[]>;

  for (const locale of HELP_LOCALES) {
    for (const other of HELP_LOCALES.filter((candidate) => candidate !== locale)) {
      for (const file of files[locale].filter((name) => !files[other].includes(name)))
        problems.push(`${other}/${file} is missing: every Legal Document is written in French and in English`);
    }
  }

  const documents = Object.fromEntries(
    HELP_LOCALES.map((locale) => [
      locale,
      files[locale]
        .flatMap((file) => {
          const where = `${locale}/${file}`;
          const [id, name] = file.split("/") as [string, string];
          const version = VERSION_FILE.exec(name)?.[1];
          if (!isLegalDocumentId(id)) problems.push(`${where}: ${id} is not one of ${LEGAL_DOCUMENTS.join(", ")}`);
          if (!version) problems.push(`${where}: the file is named after its version: 3.2.md`);
          if (!isLegalDocumentId(id) || !version) return [];
          const { document, problems: own } = parseLegalDocument(id, locale, version, readFileSync(path.join(dir, locale, file), "utf8"));
          problems.push(...own.map((problem) => `${where}: ${problem}`));
          return [document];
        })
        .sort((a, b) => LEGAL_DOCUMENTS.indexOf(a.id) - LEGAL_DOCUMENTS.indexOf(b.id) || compareLegalVersions(b.version, a.version)),
    ]),
  ) as LegalDocuments;

  for (const document of documents.en) {
    const french = documents.fr.find((candidate) => candidate.id === document.id && candidate.version === document.version);
    if (french && french.effective !== document.effective)
      problems.push(`en/${document.id}/${document.version}.md: its effective date ${document.effective} differs from the French one (${french.effective})`);
  }

  if (problems.length > 0) throw new HelpContentError(problems.join("\n"));
  return documents;
}

/** `<id>/<version>.md` of each file under `dir`. */
function markdownFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => statSync(path.join(dir, name)).isDirectory())
    .flatMap((id) =>
      readdirSync(path.join(dir, id))
        .filter((name) => name.endsWith(".md"))
        .map((name) => `${id}/${name}`),
    )
    .sort();
}

/** The Legal Document as its file says, and what is wrong with it. */
function parseLegalDocument(id: LegalDocument["id"], locale: HelpLocale, version: string, markdown: string): { document: LegalDocument; problems: string[] } {
  const problems: string[] = [];
  const { frontmatter, body } = parseFrontmatter(markdown);
  const text = (value: string | string[] | undefined) => (typeof value === "string" ? value : "");
  const effective = text(frontmatter.effective);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effective)) problems.push("effective must be a day: YYYY-MM-DD");
  const title = text(frontmatter.title);
  if (!title) problems.push("title is missing");

  const parts: { title: string; lines: string[] }[] = [];
  const before: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const heading = /^##\s+(.+)$/.exec(line.trim());
    if (heading) parts.push({ title: heading[1]!.trim(), lines: [] });
    else (parts.at(-1)?.lines ?? before).push(line);
  }
  if (before.join("").trim()) problems.push("text before the first section: every part sits under a ## heading");

  const summaryPart = parts[0]?.title === SUMMARY_HEADINGS[locale] ? parts.shift()! : null;
  const summary = (summaryPart?.lines ?? []).flatMap((line) => /^\s*[-*]\s+(.+)$/.exec(line)?.[1] ?? []);
  if (parts.length === 0) problems.push("it has no section");

  return {
    document: {
      id,
      locale,
      version,
      effective,
      title,
      summary,
      sections: parts.map((part, index) => ({ id: `section-${index + 1}`, number: index + 1, title: part.title, body: part.lines.join("\n").trim() })),
    },
    problems,
  };
}
