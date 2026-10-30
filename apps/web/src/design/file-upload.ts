/** What a File upload accepts: its largest size in bytes and its extensions, lower case without the dot. */
export type FileRules = { maxBytes: number; extensions: readonly string[] };

/** Why a File upload refuses a file before sending it; the same codes as the server's, so one message says each. */
export type FileProblem = "unsupported_format" | "too_large";

const extensionOf = (name: string): string | null => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : null;
};

/**
 * What is wrong with a chosen file, null when nothing (#468): its format first (a film is not a CV, however large),
 * then its size. The server checks again: this only saves the Candidate a wait.
 */
export function fileProblem(file: { name: string; size: number }, rules: FileRules): FileProblem | null {
  const extension = extensionOf(file.name);
  if (!extension || !rules.extensions.includes(extension)) return "unsupported_format";
  if (file.size > rules.maxBytes) return "too_large";
  return null;
}

/** The badge on a chosen file's row and on the Viewer's toolbar: PDF or DOCX, null for any other file. */
export function fileKind(name: string): "pdf" | "docx" | null {
  const extension = extensionOf(name);
  return extension === "pdf" || extension === "docx" ? extension : null;
}

const UNITS = { fr: { kb: "Ko", mb: "Mo" }, en: { kb: "KB", mb: "MB" } } as const;

/** A file's size in words: kilobytes under a megabyte (at least 1), megabytes with one decimal above. */
export function fileSize(bytes: number, language: string): string {
  const lang = language.startsWith("en") ? "en" : "fr";
  const units = UNITS[lang];
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${Math.max(1, Math.round(kilobytes))} ${units.kb}`;
  const megabytes = new Intl.NumberFormat(lang, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(kilobytes / 1024);
  return `${megabytes} ${units.mb}`;
}
