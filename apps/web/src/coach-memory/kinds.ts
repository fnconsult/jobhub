/**
 * What a Coach Memory item is, and its limits. No server-only imports: the
 * Coach Panel bundles it.
 */

export const COACH_MEMORY_KINDS = ["goal", "constraint", "decision"] as const;
export type CoachMemoryKind = (typeof COACH_MEMORY_KINDS)[number];

/** A key fact the AI Coach may propose, before the Candidate confirms it. */
export interface ProposedMemoryItem {
  kind: CoachMemoryKind;
  text: string;
}

/** Longest item, in characters. */
export const MAX_ITEM_LENGTH = 300;
/** Most items in one Candidate's Coach Memory: it goes with every AI Coach message, so it stays short. */
export const MAX_ITEMS = 30;

/**
 * A fact as Coach Memory compares it (#773): the same whatever its case, accents and spacing (« Genève » is « geneve »).
 * Every path that tells a fact already remembered uses it: confirming one, the AI Coach's proposals, its Coach Action.
 */
export function sameFact(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim().toLocaleLowerCase("fr");
}
