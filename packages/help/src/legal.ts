import type { HelpLocale } from "./types";

/**
 * The Legal Documents, in the order the Légal page lists them. Their titles, shown even before a text is written,
 * are in the catalogues (`legal.documents.<id>`); the texts are the team's, never an AI's.
 */
export const LEGAL_DOCUMENTS = ["conditions-utilisation", "cgv", "confidentialite", "cookies", "sous-traitants-et-ia", "mentions-legales"] as const;
export type LegalDocumentId = (typeof LEGAL_DOCUMENTS)[number];

/** Whether `value` names a Legal Document. */
export function isLegalDocumentId(value: unknown): value is LegalDocumentId {
  return (LEGAL_DOCUMENTS as readonly unknown[]).includes(value);
}

/**
 * One version of a Legal Document in one language: written by the team in `legal/<locale>/<id>/<version>.md`.
 * Short Markdown (paragraphs and lists) in each section's `body`.
 */
export interface LegalDocument {
  id: LegalDocumentId;
  locale: HelpLocale;
  /** « 3.2 »: the file's name. */
  version: string;
  /** The day it applies from: `YYYY-MM-DD`. */
  effective: string;
  title: string;
  /** « En bref »: the few lines that sum it up; none when the text has no such section. */
  summary: string[];
  /** Its numbered sections, in order: `id` is their anchor (« Sur cette page »). */
  sections: { id: string; number: number; title: string; body: string }[];
}

/** Orders two versions (« 3.2 », « 3.10 »): negative when `a` comes first. */
export function compareLegalVersions(a: string, b: string): number {
  const [x, y] = [a, b].map((value) => value.split(".").map(Number));
  for (let i = 0; i < Math.max(x!.length, y!.length); i++) if ((x![i] ?? 0) !== (y![i] ?? 0)) return (x![i] ?? 0) - (y![i] ?? 0);
  return 0;
}
