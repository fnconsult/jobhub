/**
 * Release Note fragments (ADR-0063, #562): each PR with something a Candidate can see adds
 * `releases/unreleased/<pr>.md` (or `<pr>-<n>.md` for a second kind of change), and `npm run release-note -w @jobhub/help`
 * assembles them into the next Version's draft Release Note, `releases/{fr,en}/X.Y.Z.md`. Node only (reads and
 * writes files): never imported by `index.ts`.
 *
 * A fragment:
 *
 *   ---
 *   kind: new                 # new, improved or fixed: « Nouveau », « Amélioré » or « Corrigé »
 *   tags: [candidature]       # from RELEASE_NOTE_TAGS, [] for none
 *   announce: true            # optional: the Nouveautés email should announce the Version
 *   ---
 *   ## fr
 *   - La ligne, pour les Candidats.
 *
 *   ## en
 *   - The line, for Candidates.
 *
 * One line in each language; a PR that brings several changes of the same kind may give several, as many in English as
 * in French.
 */
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { HelpContentError, parseFrontmatter } from "./content";
import { CHANGE_SECTIONS, RELEASE_NOTE_CHANGE_KINDS, RELEASE_NOTE_TAGS, type ReleaseNote, type ReleaseNoteChangeKind, type ReleaseNoteTag } from "./release-notes";
import { DRAFT_PLACEHOLDER, parseReleaseNote, releasesDir } from "./release-notes-content";
import { HELP_LOCALES, type HelpLocale } from "./types";

export interface ReleaseNoteFragment {
  /** Its file's name in `unreleased/`. */
  file: string;
  /** The pull request that added it: the file's number. */
  pr: number;
  kind: ReleaseNoteChangeKind;
  tags: ReleaseNoteTag[];
  announce: boolean;
  lines: Record<HelpLocale, string[]>;
}

const FRAGMENT_FILE = /^(\d+)(-[a-z0-9-]+)?\.md$/;

/** Where the fragments wait for the next Version. */
export function unreleasedDir(dir: string = releasesDir): string {
  return path.join(dir, "unreleased");
}

/** Reads every fragment of `dir/unreleased` (default: this package's), by PR. Throws `HelpContentError` listing every problem. */
export function readReleaseNoteFragments(dir: string = releasesDir): ReleaseNoteFragment[] {
  const where = unreleasedDir(dir);
  if (!existsSync(where)) return [];
  const problems: string[] = [];
  const fragments = readdirSync(where)
    .filter((file) => file.endsWith(".md"))
    .flatMap((file) => {
      const { fragment, problems: own } = parseFragment(file, readFileSync(path.join(where, file), "utf8"));
      problems.push(...own.map((problem) => `unreleased/${file}: ${problem}`));
      return fragment ? [fragment] : [];
    })
    .sort((a, b) => a.pr - b.pr || a.file.localeCompare(b.file));
  if (problems.length > 0) throw new HelpContentError(problems.join("\n"));
  return fragments;
}

function parseFragment(file: string, markdown: string): { fragment: ReleaseNoteFragment | null; problems: string[] } {
  const problems: string[] = [];
  const name = FRAGMENT_FILE.exec(file);
  if (!name) problems.push("a fragment is named after its pull request: <pr>.md, or <pr>-<n>.md");
  if (!/^---\r?\n/.test(markdown)) problems.push("the front matter is missing: kind, tags and, if need be, announce");
  const { frontmatter, body } = parseFrontmatter(markdown);

  const kind = typeof frontmatter.kind === "string" ? frontmatter.kind : "";
  if (!(RELEASE_NOTE_CHANGE_KINDS as readonly string[]).includes(kind)) problems.push(`kind must be one of ${RELEASE_NOTE_CHANGE_KINDS.join(", ")}`);
  const tags = Array.isArray(frontmatter.tags) ? frontmatter.tags : [];
  if (!Array.isArray(frontmatter.tags)) problems.push("tags must be a list: [candidature], or [] for none");
  for (const tag of tags.filter((tag) => !(RELEASE_NOTE_TAGS as readonly string[]).includes(tag)))
    problems.push(`tag ${tag} is not one of ${RELEASE_NOTE_TAGS.join(", ")}`);
  const announce = frontmatter.announce;
  if (announce !== undefined && announce !== "true" && announce !== "false") problems.push("announce is true or false");

  const lines: Record<HelpLocale, string[]> = { fr: [], en: [] };
  let locale: HelpLocale | null = null;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) {
      const named = heading[1]!.trim();
      locale = (HELP_LOCALES as readonly string[]).includes(named) ? (named as HelpLocale) : null;
      if (!locale) problems.push(`section « ${named} » is not one of ${HELP_LOCALES.join(", ")}`);
      continue;
    }
    if (!line || !locale) continue;
    const item = /^[-*]\s+(.+)$/.exec(line);
    if (item) lines[locale].push(item[1]!);
    else if (lines[locale].length > 0) lines[locale][lines[locale].length - 1] += ` ${line}`;
    else problems.push(`## ${locale}: a line is a list item: - …`);
  }
  for (const each of HELP_LOCALES) if (lines[each].length === 0) problems.push(`its ${each} line is missing: every fragment is written in French and in English`);
  if (lines.fr.length > 0 && lines.en.length > 0 && lines.fr.length !== lines.en.length)
    problems.push(`${lines.fr.length} French lines but ${lines.en.length} English ones`);

  if (problems.length > 0 || !name) return { fragment: null, problems };
  return { fragment: { file, pr: Number(name[1]), kind: kind as ReleaseNoteChangeKind, tags: tags as ReleaseNoteTag[], announce: announce === "true", lines }, problems };
}

/** The draft of `version`'s Release Note in `locale`: `existing`, or a new one to title and introduce, with the fragments' lines. */
export function draftReleaseNote(
  locale: HelpLocale,
  version: string,
  date: string,
  fragments: readonly ReleaseNoteFragment[],
  existing: ReleaseNote | null,
): ReleaseNote {
  const tags = new Set<ReleaseNoteTag>([...(existing?.tags ?? []), ...fragments.flatMap((fragment) => fragment.tags)]);
  const changes = [...(existing?.changes ?? []), ...fragments.flatMap((fragment) => fragment.lines[locale].map((text) => ({ kind: fragment.kind, text })))];
  return {
    version,
    locale,
    date: existing?.date ?? date,
    title: existing?.title ?? DRAFT_PLACEHOLDER[locale],
    tags: RELEASE_NOTE_TAGS.filter((tag) => tags.has(tag)),
    image: existing?.image ?? null,
    announce: (existing?.announce ?? false) || fragments.some((fragment) => fragment.announce),
    intro: existing?.intro ?? DRAFT_PLACEHOLDER[locale],
    // Grouped by kind, in the order of the sections; within one, the existing lines first, then by PR.
    changes: RELEASE_NOTE_CHANGE_KINDS.flatMap((kind) => changes.filter((change) => change.kind === kind)),
  };
}

/** A Release Note's Markdown file, as `readReleaseNotes` reads it. */
export function renderReleaseNote(note: ReleaseNote): string {
  const front = [
    "---",
    `version: ${note.version}`,
    `date: ${note.date}`,
    `title: ${note.title}`,
    `tags: [${note.tags.join(", ")}]`,
    ...(note.image ? [`image: ${note.image.file}`, `image-alt: ${note.image.alt}`] : []),
    `announce: ${note.announce}`,
    "---",
  ];
  const sections = RELEASE_NOTE_CHANGE_KINDS.flatMap((kind) => {
    const lines = note.changes.filter((change) => change.kind === kind);
    return lines.length > 0 ? ["", `## ${CHANGE_SECTIONS[note.locale][kind]}`, ...lines.map((change) => `- ${change.text}`)] : [];
  });
  return [...front, note.intro, ...sections, ""].join("\n");
}

export interface Assembly {
  version: string;
  /** The fragments assembled, now removed from `unreleased/`. */
  fragments: string[];
  /** The drafts written, relative to the releases directory. */
  written: string[];
  /** Whether each draft still has its title and introduction to write. */
  toWrite: boolean;
}

/**
 * Assembles every fragment of `dir/unreleased` into `version`'s Release Note in French and in English (adding to it
 * when it exists), then removes them. Writes nothing when there is no fragment. Throws on an invalid fragment or note.
 */
export function assembleReleaseNote({ dir = releasesDir, version, date }: { dir?: string; version: string; date: string }): Assembly {
  const fragments = readReleaseNoteFragments(dir);
  if (fragments.length === 0) return { version, fragments: [], written: [], toWrite: false };
  const drafts = HELP_LOCALES.map((locale) => {
    const file = path.join(dir, locale, `${version}.md`);
    let existing: ReleaseNote | null = null;
    if (existsSync(file)) {
      const { note, problems } = parseReleaseNote(locale, readFileSync(file, "utf8"));
      if (problems.length > 0) throw new HelpContentError(problems.map((problem) => `${locale}/${version}.md: ${problem}`).join("\n"));
      existing = note;
    }
    return { locale, file, note: draftReleaseNote(locale, version, date, fragments, existing) };
  });
  for (const { file, note } of drafts) writeFileSync(file, renderReleaseNote(note));
  for (const fragment of fragments) rmSync(path.join(unreleasedDir(dir), fragment.file));
  return {
    version,
    fragments: fragments.map((fragment) => fragment.file),
    written: drafts.map(({ locale }) => `${locale}/${version}.md`),
    toWrite: drafts.some(({ note }) => note.title === DRAFT_PLACEHOLDER[note.locale] || note.intro === DRAFT_PLACEHOLDER[note.locale]),
  };
}

export interface ReleaseNoteStatus {
  version: string;
  /** Whether `releases/<locale>/<version>.md` exists. */
  note: Record<HelpLocale, boolean>;
  /** The fragments waiting in `unreleased/`. */
  fragments: number;
}

/** Where `version`'s Release Note stands: written, waiting in fragments, or neither. Reads only. */
export function releaseNoteStatus({ dir = releasesDir, version }: { dir?: string; version: string }): ReleaseNoteStatus {
  const where = unreleasedDir(dir);
  return {
    version,
    note: Object.fromEntries(HELP_LOCALES.map((locale) => [locale, existsSync(path.join(dir, locale, `${version}.md`))])) as Record<HelpLocale, boolean>,
    fragments: existsSync(where) ? readdirSync(where).filter((file) => file.endsWith(".md")).length : 0,
  };
}

/** The status in one French sentence, for the deploy-staging report. Never blocks: the Beta deploys either way. */
export function describeReleaseNoteStatus({ version, note, fragments }: ReleaseNoteStatus): string {
  const waiting = fragments === 0 ? "aucun fragment en attente" : `${fragments} fragment${fragments > 1 ? "s" : ""} en attente dans releases/unreleased/`;
  if (note.fr && note.en) return `Release Note ${version} : écrite en français et en anglais ; ${waiting}.`;
  const missing = HELP_LOCALES.filter((locale) => !note[locale]).join(" et ");
  if (fragments > 0) return `Release Note ${version} : pas encore assemblée (${missing} manquant) ; ${waiting}, à assembler avant la Promotion (npm run release-note -w @jobhub/help).`;
  return `Release Note ${version} : absente (${missing}) et aucun fragment en attente. À écrire avant la Promotion, sauf si rien de visible pour un Candidat n'a changé (--rien-de-visible).`;
}
