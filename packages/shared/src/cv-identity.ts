import type { CvContent } from "./domain";

/**
 * The CV's identity block: what names or reaches the Candidate (name, postal address, phone, email).
 * An AI call carrying it carries the Candidate's identity (ADR-0007 amendment).
 */
export const CV_IDENTITY_FIELDS = ["fullName", "email", "phone", "location"] as const satisfies readonly (keyof CvContent)[];

/**
 * The CV with its identity block left empty, for an AI call that needs the career, not the person
 * (e.g. scoring or adapting a CV), so it never carries the Candidate's identity.
 */
export function withoutIdentity(cv: CvContent): CvContent {
  return { ...cv, ...Object.fromEntries(CV_IDENTITY_FIELDS.map((field) => [field, ""])) };
}
