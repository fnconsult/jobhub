/** The Tailored Documents a Human Coach can give a Coach Review of. Safe to use in the browser. */
export const REVIEWED_DOCUMENTS = ["tailored_cv", "cover_letter", "outreach_message"] as const;
export type ReviewedDocument = (typeof REVIEWED_DOCUMENTS)[number];

/** Longest Coach Review kept, in characters. */
export const MAX_REVIEW_LENGTH = 5_000;
