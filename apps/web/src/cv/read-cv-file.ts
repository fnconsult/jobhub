import { extractText, getDocumentProxy } from "unpdf";

/** Why an uploaded file could not be read as a CV. Each code has a translated message (`cvUpload.errors.<code>`). */
export type CvFileErrorCode = "unsupported_format" | "too_large" | "unreadable" | "empty";

export class CvFileError extends Error {
  constructor(readonly code: CvFileErrorCode) {
    super(`CV file rejected: ${code}`);
    this.name = "CvFileError";
  }
}

/** An uploaded file, as received. */
export interface CvFile {
  name: string;
  bytes: Uint8Array;
}

/** Largest CV file accepted, in bytes. */
export const MAX_CV_FILE_BYTES = 10 * 1024 * 1024;

const startsWith = (bytes: Uint8Array, signature: number[]) => signature.every((byte, i) => bytes[i] === byte);
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46]; // %PDF
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04]; // PK.. (DOCX is a zip package)

/** The text of a PDF or Word (.docx) CV, one line per line of the document. */
export async function readCvFile(file: CvFile): Promise<string> {
  if (file.bytes.byteLength > MAX_CV_FILE_BYTES) throw new CvFileError("too_large");
  const extension = file.name.toLowerCase().split(".").pop();

  let text: string;
  try {
    if (extension === "pdf" && startsWith(file.bytes, PDF_SIGNATURE)) {
      // pdf.js may take ownership of the buffer it is given: hand it a copy.
      const pdf = await getDocumentProxy(new Uint8Array(file.bytes));
      text = (await extractText(pdf, { mergePages: true })).text;
    } else if (extension === "docx" && startsWith(file.bytes, ZIP_SIGNATURE)) {
      const mammoth = await import("mammoth");
      text = (await mammoth.extractRawText({ buffer: Buffer.from(file.bytes) })).value;
    } else {
      throw new CvFileError("unsupported_format");
    }
  } catch (error) {
    if (error instanceof CvFileError) throw error;
    throw new CvFileError("unreadable");
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (lines.length === 0) throw new CvFileError("empty");
  return lines.join("\n");
}
