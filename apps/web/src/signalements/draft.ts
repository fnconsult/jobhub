/**
 * The Signalement dialog's draft (#375): what the Candidate typed and the type they chose, kept in memory for the visit.
 * Esc, Annuler or a click outside closes the dialog and the next opening shows it again, whichever Sidebar (docked, or
 * the phone's drawer) opens it; once sent it is forgotten. Never stored: a reload starts afresh.
 */

/** The types a Candidate chooses in the dialog; a Question is sent only from the Coach Panel (#345). */
export const DRAFT_TYPES = ["bug", "idee"] as const;
export type DraftType = (typeof DRAFT_TYPES)[number];
export interface Draft {
  type: DraftType;
  text: string;
}

const EMPTY: Draft = { type: "bug", text: "" };
let kept: Draft = EMPTY;

export const keptDraft = (): Draft => ({ ...kept });
export const keepDraft = (draft: Draft) => {
  kept = { ...draft };
};
export const forgetDraft = () => {
  kept = EMPTY;
};
