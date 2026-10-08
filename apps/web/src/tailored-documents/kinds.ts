/** The kinds of Tailored Documents this module drafts, and how an Outreach Message is sent. Safe to use in the browser. */
export const TAILORED_DOCUMENTS = ["cover_letter", "outreach_message"] as const;
export type TailoredDocumentKind = (typeof TAILORED_DOCUMENTS)[number];

/** How an Outreach Message reaches the contact: an email, or a LinkedIn InMail the Candidate sends themselves (ADR-0001). */
export const OUTREACH_CHANNELS = ["email", "inmail"] as const;
export type OutreachChannel = (typeof OUTREACH_CHANNELS)[number];
