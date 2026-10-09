/** The documents of an Application that can be downloaded. Safe to use in the browser. */
export const APPLICATION_EXPORTS = ["tailored_cv", "cover_letter"] as const;
export type ApplicationExportKind = (typeof APPLICATION_EXPORTS)[number];
