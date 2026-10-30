import type { HelpLocale } from "./types";

/**
 * The Nouveautés tags a Release Note may carry (ADR-0063, #505): a closed list, the same in both languages. The page
 * says them in the Interface Language (`nouveautes.tags.<tag>` in the catalogues) and filters by them.
 */
export const RELEASE_NOTE_TAGS = ["candidature", "extension", "coach-ia", "confidentialite", "accessibilite"] as const;
export type ReleaseNoteTag = (typeof RELEASE_NOTE_TAGS)[number];

/** What a change line says it is: « Nouveau », « Amélioré » or « Corrigé ». */
export const RELEASE_NOTE_CHANGE_KINDS = ["new", "improved", "fixed"] as const;
export type ReleaseNoteChangeKind = (typeof RELEASE_NOTE_CHANGE_KINDS)[number];

/** The headings of a Release Note's sections, in each language, for each kind of change line. */
export const CHANGE_SECTIONS: Record<HelpLocale, Record<ReleaseNoteChangeKind, string>> = {
  fr: { new: "Nouveau", improved: "Amélioré", fixed: "Corrigé" },
  en: { new: "New", improved: "Improved", fixed: "Fixed" },
};

/**
 * What one Version brings, for Candidates, in one language (ADR-0063): written by the team in
 * `releases/<locale>/X.Y.Z.md`, the French text prevailing. Short Markdown in `intro` and each change's `text`.
 */
export interface ReleaseNote {
  /** The Version, `X.Y.Z`: the file's name. */
  version: string;
  locale: HelpLocale;
  /** The day it was Promoted, or is to be: `YYYY-MM-DD`. */
  date: string;
  title: string;
  tags: ReleaseNoteTag[];
  /** An image from `apps/web/public/nouveautes/`, and the words that say what it shows. */
  image: { file: string; alt: string } | null;
  /** Whether the Nouveautés email announces it. */
  announce: boolean;
  intro: string;
  changes: { kind: ReleaseNoteChangeKind; text: string }[];
}

/** What the Nouveautés page shows: the next Version's Release Note on the Beta, then the published ones, newest first. */
export interface Nouveautes {
  /** « Version bêta, pas encore publiée »: the Release Note of the Version the Beta serves. Null elsewhere. */
  beta: ReleaseNote | null;
  published: ReleaseNote[];
}

/**
 * The Release Notes a deployment shows, from those it was built with: on the Beta (`beta`), the note of the `version`
 * it serves is not published yet (a Version is born at its Promotion); a note of a later Version is never shown. With
 * no `version` known, every note is published. Newest first, by Version.
 */
export function nouveautes(notes: readonly ReleaseNote[], { version, beta }: { version: string | null; beta: boolean }): Nouveautes {
  const newestFirst = [...notes].sort((a, b) => compareVersions(b.version, a.version));
  if (!version) return { beta: null, published: newestFirst };
  return {
    beta: beta ? (newestFirst.find((note) => compareVersions(note.version, version) === 0) ?? null) : null,
    published: newestFirst.filter((note) => {
      const order = compareVersions(note.version, version);
      return order < 0 || (order === 0 && !beta);
    }),
  };
}

/** Orders two `X.Y.Z` Versions: negative when `a` comes first. */
export function compareVersions(a: string, b: string): number {
  const [x, y] = [a, b].map((value) => value.split(".").map(Number));
  for (let i = 0; i < 3; i++) if (x![i] !== y![i]) return (x![i] ?? 0) - (y![i] ?? 0);
  return 0;
}
