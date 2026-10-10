/** The CV Templates and file formats a document is exported in. Safe to use in the browser. */

/** The CV Templates, all ATS-safe. The first one is the default. */
export const CV_TEMPLATES = ["classic", "modern", "compact"] as const;
export type CvTemplate = (typeof CV_TEMPLATES)[number];

export const EXPORT_FORMATS = ["pdf", "docx"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
