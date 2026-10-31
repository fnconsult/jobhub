import type { HelpLocale } from "./types";

/**
 * The Legal Texts (ADR-0062), in the order Légal lists them: the CGU, the CGV (with the withdrawal form), the privacy
 * policy (with its cookies and « IA dans Jobbbox » sections) and the legal notice. Their titles, shown even before a
 * text is written, are in the catalogues (`legal.texts.<id>`); the texts are the team's, never an AI's.
 */
export const LEGAL_TEXTS = ["cgu", "cgv", "confidentialite", "mentions-legales"] as const;
export type LegalTextId = (typeof LEGAL_TEXTS)[number];

/** Whether `value` names a Legal Text. */
export function isLegalTextId(value: unknown): value is LegalTextId {
  return (LEGAL_TEXTS as readonly unknown[]).includes(value);
}

/**
 * The sections other decisions link to, by their stable anchor: every version of the text has them (`## Titre {#ia}`).
 * The cookies and « IA dans Jobbbox » sections of the privacy policy (ADR-0064), the Guest's short CGU (#550) and the
 * CGV's withdrawal form (#511).
 */
export const LEGAL_TEXT_ANCHORS: Record<LegalTextId, readonly string[]> = {
  cgu: ["invite"],
  cgv: ["retractation"],
  confidentialite: ["cookies", "ia"],
  "mentions-legales": [],
};

/**
 * How much a version changes its text (ADR-0062). Substantial: Candidates are told 30 days ahead and accept it
 * again (#547, #510). Minor: a line in the version history, nothing more.
 */
export const LEGAL_TEXT_CHANGES = ["substantielle", "mineure"] as const;
export type LegalTextChange = (typeof LEGAL_TEXT_CHANGES)[number];

/** A day, `YYYY-MM-DD`: a Legal Text Version's id, and the day it takes effect. */
export const LEGAL_TEXT_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One Legal Text Version in one language: the file `legal/<text>/<effective>.<locale>.md`, never edited once in
 * effect (a correction is a new version). French is binding; English is its translation, with the same id.
 */
export interface LegalTextVersion {
  text: LegalTextId;
  locale: HelpLocale;
  /** The day it takes effect, `YYYY-MM-DD`: its file's name and its id, the same in both languages. */
  effective: string;
  title: string;
  change: LegalTextChange;
  /** The product owner who signed it, as its footer says (« Approuvé par … »). */
  approvedBy: string;
  /** Its line in the version history. */
  summary: string;
  /**
   * The privacy policy's only: the Tools outside the EU (or where that was not established) it names, by catalog id
   * (`recipients_outside_eu`, #548). Switching on any other such recipient is a warning in Paramètres (ADR-0064).
   */
  recipientsOutsideEu?: string[];
  /** « En bref »: the few lines that sum it up; none when the text has no such section. */
  inBrief: string[];
  /** Its numbered sections, in order: `id` is their anchor (« Sur cette page »), stable when the file names it. */
  sections: { id: string; number: number; title: string; body: string }[];
}

/**
 * One Legal Text Version as the Acceptances (#510) record it, computed at build: its id (the effective date), its
 * permanent URL (site-relative), the SHA-256 of its French file, the binding text, and its change.
 */
export interface LegalTextVersionRecord {
  text: LegalTextId;
  version: string;
  url: string;
  sha256: string;
  change: LegalTextChange;
}

/** One line of the version history: a version in effect so far. */
export interface LegalTextHistoryEntry {
  effective: string;
  change: LegalTextChange;
  summary: string;
  url: string;
}

/** The permanent URL of a Legal Text Version: `/legal/<text>/<YYYY-MM-DD>`. */
export function legalTextVersionUrl(text: LegalTextId, version: string): string {
  return `/legal/${text}/${version}`;
}

/** Today's day in France (Europe/Paris), `YYYY-MM-DD`: the day effective dates are compared with. */
export function parisDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
