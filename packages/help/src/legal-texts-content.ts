/**
 * Reads and checks the Legal Text Versions' Markdown files (`legal/<text>/<YYYY-MM-DD>.<fr|en>.md`, ADR-0062), and
 * writes them, with the version registry of #510, as the `legal-texts.generated.ts` module the app bundles. Node only
 * (reads files): never imported by `index.ts`.
 *
 *   writeFileSync(legalTextsModulePath, renderLegalTextsModule(readLegalTexts()));
 *
 * A version's file: front matter (`title`, `effective`, equal to the file's name, `change: substantielle | mineure`,
 * `approved_by`, `summary`, its line in the version history), then its sections, each under a `##` heading: an
 * optional first « En bref » (« In short ») list, then the numbered sections, numbered by their order. A section
 * names its stable anchor after its title (`## Cookies {#cookies}`); the others are `section-<n>`.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HelpContentError, parseFrontmatter } from "./content";
import {
  isLegalTextId,
  LEGAL_TEXT_ANCHORS,
  LEGAL_TEXT_CHANGES,
  LEGAL_TEXTS,
  legalTextVersionUrl,
  type LegalTextChange,
  type LegalTextId,
  type LegalTextVersion,
  type LegalTextVersionRecord,
} from "./legal-texts";
import type { HelpLocale } from "./types";

export type LegalTexts = Record<HelpLocale, LegalTextVersion[]> & { registry: LegalTextVersionRecord[] };

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** This package's own legal directory. */
export const legalDir = path.join(packageDir, "legal");

/** The module `index.ts` serves the Legal Text Versions from, written by `renderLegalTextsModule`. */
export const legalTextsModulePath = path.join(packageDir, "src", "legal-texts.generated.ts");

const SUMMARY_HEADINGS: Record<HelpLocale, string> = { fr: "En bref", en: "In short" };
const VERSION_FILE = /^(\d{4}-\d{2}-\d{2})\.(fr|en)\.md$/;
const ANCHORED = /^(.+?)\s*\{#([a-z0-9-]+)\}$/;

/** The source of `legal-texts.generated.ts`: every version of every Legal Text, by text, newest first, and the registry. */
export function renderLegalTextsModule(texts: LegalTexts): string {
  return [
    "// Written by `npm run build -w @jobhub/help` from legal/<text>/<YYYY-MM-DD>.<locale>.md: edit those, never this file.",
    'import type { LegalTextVersion, LegalTextVersionRecord } from "./legal-texts";',
    'import type { HelpLocale } from "./types";',
    "",
    `export const LEGAL_TEXT_VERSIONS: Record<HelpLocale, readonly LegalTextVersion[]> = ${JSON.stringify({ fr: texts.fr, en: texts.en }, null, 2)};`,
    "",
    `export const LEGAL_TEXT_REGISTRY: readonly LegalTextVersionRecord[] = ${JSON.stringify(texts.registry, null, 2)};`,
    "",
  ].join("\n");
}

/** Reads every Legal Text Version of `dir` (default: this package's `legal/`). Throws `HelpContentError` listing every problem. */
export function readLegalTexts(dir: string = legalDir): LegalTexts {
  const problems: string[] = [];
  const files = markdownFiles(dir);
  const named = new Map<string, { text: LegalTextId; effective: string; locale: HelpLocale }>();
  for (const file of files) {
    const [text, name] = file.split("/") as [string, string];
    const match = VERSION_FILE.exec(name);
    if (!isLegalTextId(text)) problems.push(`${file}: ${text} is not one of ${LEGAL_TEXTS.join(", ")}`);
    if (!match) problems.push(`${file}: a version's file is named <effective date>.<fr|en>.md: 2026-12-01.fr.md`);
    if (isLegalTextId(text) && match) named.set(file, { text, effective: match[1]!, locale: match[2] as HelpLocale });
  }

  for (const [file, { locale }] of named) {
    const twin = file.replace(/\.(fr|en)\.md$/, locale === "fr" ? ".en.md" : ".fr.md");
    if (named.has(twin)) continue;
    problems.push(locale === "en" ? `${twin} is missing: French is the binding text, English its translation` : `${twin} is missing: every version is translated into English`);
  }

  const versions = [...named].map(([file, { text, effective, locale }]) => {
    const markdown = readFileSync(path.join(dir, file), "utf8");
    const { version, problems: own } = parseLegalTextVersion(text, locale, effective, markdown);
    problems.push(...own.map((problem) => `${file}: ${problem}`));
    return { file, version, markdown };
  });
  const byText = (a: LegalTextVersion, b: LegalTextVersion) => LEGAL_TEXTS.indexOf(a.text) - LEGAL_TEXTS.indexOf(b.text) || b.effective.localeCompare(a.effective);
  const inLocale = (locale: HelpLocale) => versions.map((entry) => entry.version).filter((version) => version.locale === locale).sort(byText);

  const french = versions.filter((entry) => entry.version.locale === "fr");
  for (const { file, version } of versions.filter((entry) => entry.version.locale === "en")) {
    const original = french.find((entry) => entry.file === file.replace(/\.en\.md$/, ".fr.md"))?.version;
    if (original && LEGAL_TEXT_CHANGES.includes(version.change) && original.change !== version.change)
      problems.push(`${file}: its change ${version.change} differs from the French one (${original.change})`);
  }

  if (problems.length > 0) throw new HelpContentError(problems.join("\n"));
  const registry = french
    .sort((a, b) => byText(a.version, b.version))
    .map(({ version, markdown }) => ({
      text: version.text,
      version: version.effective,
      url: legalTextVersionUrl(version.text, version.effective),
      sha256: createHash("sha256").update(markdown).digest("hex"),
      change: version.change,
    }));
  return { fr: inLocale("fr"), en: inLocale("en"), registry };
}

/** `<text>/<file>.md` of each Markdown file under `dir`'s text directories. */
function markdownFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => statSync(path.join(dir, name)).isDirectory())
    .flatMap((text) =>
      readdirSync(path.join(dir, text))
        .filter((name) => name.endsWith(".md"))
        .map((name) => `${text}/${name}`),
    )
    .sort();
}

/** The Legal Text Version as its file says, and what is wrong with it. */
function parseLegalTextVersion(text: LegalTextId, locale: HelpLocale, named: string, markdown: string): { version: LegalTextVersion; problems: string[] } {
  const problems: string[] = [];
  const { frontmatter, body } = parseFrontmatter(markdown);
  const field = (key: string) => (typeof frontmatter[key] === "string" ? (frontmatter[key] as string) : "");
  const title = field("title");
  if (!title) problems.push("title is missing");
  const effective = field("effective");
  if (effective !== named) problems.push(`effective ${effective || "(missing)"} differs from the file's name: a version is named after its effective date`);
  const change = field("change") as LegalTextChange;
  if (!LEGAL_TEXT_CHANGES.includes(change)) problems.push(`change must be ${LEGAL_TEXT_CHANGES.join(" or ")}`);
  const approvedBy = field("approved_by");
  if (!approvedBy) problems.push("approved_by is missing: the product owner who signs the version");
  const summary = field("summary");
  if (!summary) problems.push("summary is missing: the version's line in the version history");

  const parts: { title: string; lines: string[] }[] = [];
  const before: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const heading = /^##\s+(.+)$/.exec(line.trim());
    if (heading) parts.push({ title: heading[1]!.trim(), lines: [] });
    else (parts.at(-1)?.lines ?? before).push(line);
  }
  if (before.join("").trim()) problems.push("text before the first section: every part sits under a ## heading");

  const summaryPart = parts[0]?.title === SUMMARY_HEADINGS[locale] ? parts.shift()! : null;
  const inBrief = (summaryPart?.lines ?? []).flatMap((line) => /^\s*[-*]\s+(.+)$/.exec(line)?.[1] ?? []);
  if (parts.length === 0) problems.push("it has no section");

  const sections = parts.map((part, index) => {
    const anchored = ANCHORED.exec(part.title);
    return { id: anchored?.[2] ?? `section-${index + 1}`, number: index + 1, title: anchored?.[1] ?? part.title, body: part.lines.join("\n").trim() };
  });
  const ids = sections.map((section) => section.id);
  for (const id of new Set(ids)) if (ids.filter((other) => other === id).length > 1) problems.push(`#${id} anchors two sections`);
  if (parts.length > 0) for (const anchor of LEGAL_TEXT_ANCHORS[text]) if (!ids.includes(anchor)) problems.push(`no section is anchored #${anchor}`);

  return { version: { text, locale, effective: named, title, change, approvedBy, summary, inBrief, sections }, problems };
}
