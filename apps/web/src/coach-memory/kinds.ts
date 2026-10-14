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
