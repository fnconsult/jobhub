/**
 * Request header naming the Interface Language a page is shown in, when the URL
 * chooses it rather than the signed-in Candidate (the Job Digest unsubscribe
 * page, opened from an email in the Candidate's language). Set only by
 * `src/proxy.ts`, which overwrites any value a client sent.
 */
export const LOCALE_HEADER = "x-jobhub-locale";
