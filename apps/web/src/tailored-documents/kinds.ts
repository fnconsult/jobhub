/** The kinds of Tailored Documents this module drafts, and how an Outreach Message is sent. Safe to use in the browser. */
export const TAILORED_DOCUMENTS = ["cover_letter", "outreach_message"] as const;
export type TailoredDocumentKind = (typeof TAILORED_DOCUMENTS)[number];

/** How an Outreach Message reaches the contact: an email, or a LinkedIn InMail the Candidate sends themselves (ADR-0001). */
export const OUTREACH_CHANNELS = ["email", "inmail"] as const;
export type OutreachChannel = (typeof OUTREACH_CHANNELS)[number];

/** Longest text kept for a draft, in characters: a long letter is about 4,000. */
export const MAX_DRAFT_LENGTH = 10_000;
export const MAX_SUBJECT_LENGTH = 300;

/** The documents whose earlier versions an Application keeps (#1079): its Tailored CV, Cover Letter and Outreach Message. */
export const VERSIONED_DOCUMENTS = ["tailored_cv", "cover_letter", "outreach_message"] as const;
export type VersionedDocument = (typeof VERSIONED_DOCUMENTS)[number];

/**
 * Where a Tailored Document Version came from: `drafted`, written by the AI Coach (a drafting, a new drafting, a Tailored
 * CV proposal saved once reviewed); `candidate`, the Candidate's own save; `coach`, a Coach proposal they applied
 * (ADR-0109); `restored`, a Restore of an earlier version (« Annuler » on a Coach proposal included).
 */
export const VERSION_SOURCES = ["drafted", "candidate", "coach", "restored"] as const;
export type VersionSource = (typeof VERSION_SOURCES)[number];

/** How many versions each document keeps (#1079): past it, the oldest goes first. Said in the Help Articles. */
export const MAX_DOCUMENT_VERSIONS = 20;
