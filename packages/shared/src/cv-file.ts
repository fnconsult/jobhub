/**
 * What a CV file may be (#468, ADR-0068): a PDF or a Word file (.docx), up to 10 MB. One file for every side: the web
 * app's server refuses anything else, and the web's File upload, the extension and the app refuse it before sending it,
 * so the Candidate learns at once instead of after a long send. Before the send this is a courtesy: the server's answer wins.
 */

/** Largest CV file accepted, in bytes. */
export const MAX_CV_FILE_BYTES = 10 * 1024 * 1024;

/** A CV file's extensions, lower case without the dot. */
export const CV_FILE_EXTENSIONS = ["pdf", "docx"] as const;

/** Why a CV file is refused before it is sent: the server's own codes, so one message says each. */
export type CvFileProblem = "unsupported_format" | "too_large";

/** What is wrong with a CV file, null when nothing: its format first (a film is not a CV, however large), then its size. */
export function cvFileProblem(file: { name: string; size: number }): CvFileProblem | null {
  const dot = file.name.lastIndexOf(".");
  const extension = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : null;
  if (!extension || !(CV_FILE_EXTENSIONS as readonly string[]).includes(extension)) return "unsupported_format";
  if (file.size > MAX_CV_FILE_BYTES) return "too_large";
  return null;
}
