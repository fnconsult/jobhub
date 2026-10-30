/**
 * Reads and checks the Release Notes' Markdown files (`releases/<locale>/X.Y.Z.md`, ADR-0063), and writes them as the
 * `release-notes.generated.ts` module the app bundles: each deployment shows the notes it was built with. Node only
 * (reads files): never imported by `index.ts`.
 *
 *   writeFileSync(releaseNotesModulePath, renderReleaseNotesModule(readReleaseNotes()));
 *
 * A Release Note's file: front matter (`version`, `date`, `title`, `tags`, optional `image` and `image-alt`,
 * optional `announce: true`), an introduction, then its « Nouveau », « Amélioré » and « Corrigé » sections (« New »,
 * « Improved », « Fixed » in English), each a list of lines.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HelpContentError, parseFrontmatter } from "./content";
import { CHANGE_SECTIONS, compareVersions, RELEASE_NOTE_CHANGE_KINDS, RELEASE_NOTE_TAGS, type ReleaseNote, type ReleaseNoteChangeKind } from "./release-notes";
import { HELP_LOCALES, type HelpLocale } from "./types";

export type ReleaseNotes = Record<HelpLocale, ReleaseNote[]>;

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** This package's own releases directory. */
export const releasesDir = path.join(packageDir, "releases");

/** The module `index.ts` serves the Release Notes from, written by `renderReleaseNotesModule`. */
export const releaseNotesModulePath = path.join(packageDir, "src", "release-notes.generated.ts");

const VERSION_FILE = /^(\d+\.\d+\.\d+)\.md$/;

/** The source of `release-notes.generated.ts`: every Release Note, by Version, newest first. */
export function renderReleaseNotesModule(notes: ReleaseNotes): string {
  const sorted = Object.fromEntries(HELP_LOCALES.map((locale) => [locale, [...notes[locale]].sort((a, b) => compareVersions(b.version, a.version))]));
  return [
    "// Written by `npm run build -w @jobhub/help` from releases/<locale>/X.Y.Z.md: edit those, never this file.",
    'import type { ReleaseNote } from "./release-notes";',
    'import type { HelpLocale } from "./types";',
    "",
    `export const RELEASE_NOTES: Record<HelpLocale, readonly ReleaseNote[]> = ${JSON.stringify(sorted, null, 2)};`,
    "",
  ].join("\n");
}

/** Reads every Release Note of `dir` (default: this package's `releases/`). Throws `HelpContentError` listing every problem. */
export function readReleaseNotes(dir: string = releasesDir): ReleaseNotes {
  const problems: string[] = [];
  const files = Object.fromEntries(HELP_LOCALES.map((locale) => [locale, markdownFiles(path.join(dir, locale))])) as Record<HelpLocale, string[]>;

  for (const locale of HELP_LOCALES) {
    for (const other of HELP_LOCALES.filter((candidate) => candidate !== locale)) {
      for (const file of files[locale].filter((name) => !files[other].includes(name)))
        problems.push(`${other}/${file} is missing: every Release Note is written in French and in English`);
    }
  }

  const notes = Object.fromEntries(
    HELP_LOCALES.map((locale) => [
      locale,
      files[locale].flatMap((file) => {
        const where = `${locale}/${file}`;
        const name = VERSION_FILE.exec(file);
        if (!name) {
          problems.push(`${where}: the file is named after its Version: X.Y.Z.md`);
          return [];
        }
        const { note, problems: own } = parseReleaseNote(locale, readFileSync(path.join(dir, locale, file), "utf8"));
        if (note.version !== name[1]) own.push(`version ${note.version || "(none)"} is not the file's (${name[1]})`);
        problems.push(...own.map((problem) => `${where}: ${problem}`));
        return [note];
      }),
    ]),
  ) as ReleaseNotes;

  for (const note of notes.en) {
    const french = notes.fr.find((candidate) => candidate.version === note.version);
    if (!french) continue;
    const where = `en/${note.version}.md`;
    if (note.date !== french.date) problems.push(`${where}: its date ${note.date} differs from the French one (${french.date})`);
    if (note.tags.join(", ") !== french.tags.join(", ")) problems.push(`${where}: its tags ${note.tags.join(", ")} differ from the French ones (${french.tags.join(", ")})`);
  }

  if (problems.length > 0) throw new HelpContentError(problems.join("\n"));
  return notes;
}

function markdownFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort();
}

/** The Release Note as its file says, and what is wrong with it. */
function parseReleaseNote(locale: HelpLocale, markdown: string): { note: ReleaseNote; problems: string[] } {
  const problems: string[] = [];
  const { frontmatter, body } = parseFrontmatter(markdown);
  const text = (value: string | string[] | undefined) => (typeof value === "string" ? value : "");

  const date = text(frontmatter.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) problems.push("date must be a day: YYYY-MM-DD");
  const title = text(frontmatter.title);
  if (!title) problems.push("title is missing");
  const tags = Array.isArray(frontmatter.tags) ? frontmatter.tags : [];
  if (!Array.isArray(frontmatter.tags)) problems.push("tags must be a list: [candidature, coach-ia]");
  for (const tag of tags.filter((tag) => !(RELEASE_NOTE_TAGS as readonly string[]).includes(tag)))
    problems.push(`tag ${tag} is not one of ${RELEASE_NOTE_TAGS.join(", ")}`);
  const imageFile = text(frontmatter.image);
  const imageAlt = text(frontmatter["image-alt"]);
  if (imageFile && !imageAlt) problems.push("an image needs its words: image-alt");

  const sectionOf = new Map(RELEASE_NOTE_CHANGE_KINDS.map((kind) => [CHANGE_SECTIONS[locale][kind], kind]));
  const intro: string[] = [];
  const changes: ReleaseNote["changes"] = [];
  let section: ReleaseNoteChangeKind | null | "intro" = "intro";
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) {
      section = sectionOf.get(heading[1]!.trim()) ?? null;
      if (!section) problems.push(`section « ${heading[1]!.trim()} » is not one of ${Object.values(CHANGE_SECTIONS[locale]).join(", ")}`);
      continue;
    }
    if (section === "intro") intro.push(raw);
    else if (section) {
      const item = /^[-*]\s+(.+)$/.exec(line);
      if (item) changes.push({ kind: section, text: item[1]! });
      else if (line && changes.length > 0) changes.at(-1)!.text += ` ${line}`;
    }
  }
  const introduction = intro.join("\n").trim();
  if (!introduction) problems.push("the introduction is missing");

  return {
    note: {
      version: text(frontmatter.version),
      locale,
      date,
      title,
      tags: tags as ReleaseNote["tags"],
      image: imageFile ? { file: imageFile, alt: imageAlt } : null,
      announce: text(frontmatter.announce) === "true",
      intro: introduction,
      changes,
    },
    problems,
  };
}
