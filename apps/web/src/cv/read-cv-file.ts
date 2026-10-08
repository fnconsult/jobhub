import { extractImages, extractText, getDocumentProxy } from "unpdf";

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

/** What is read from a CV file: its text, and whether it shows a picture. */
export interface CvFileReading {
  /** One line per line of the document. */
  text: string;
  /** True when the CV shows a picture, most likely the Candidate's photo. */
  photo: boolean;
}

/** Smaller pictures, in pixels on either side, are icons (phone, e-mail…), not a photo. */
const MIN_PHOTO_PIXELS = 48;
/** Word keeps every picture of a document under word/media/. */
const DOCX_PICTURE = /^word\/media\/[^/]+\.(?:png|jpe?g|gif|bmp|tiff?|webp|emf|wmf)$/i;

/** The text of a PDF or Word (.docx) CV, and whether it shows a picture. */
export async function readCvFile(file: CvFile): Promise<CvFileReading> {
  if (file.bytes.byteLength > MAX_CV_FILE_BYTES) throw new CvFileError("too_large");
  const extension = file.name.toLowerCase().split(".").pop();

  let text: string;
  let photo: boolean;
  try {
    if (extension === "pdf" && startsWith(file.bytes, PDF_SIGNATURE)) {
      // pdf.js may take ownership of the buffer it is given: hand it a copy.
      const pdf = await getDocumentProxy(new Uint8Array(file.bytes));
      text = (await extractText(pdf, { mergePages: true })).text;
      photo = await pdfShowsPhoto(pdf);
    } else if (extension === "docx" && startsWith(file.bytes, ZIP_SIGNATURE)) {
      const [mammoth, { default: JSZip }] = await Promise.all([import("mammoth"), import("jszip")]);
      text = (await mammoth.extractRawText({ buffer: Buffer.from(file.bytes) })).value;
      photo = Object.keys((await JSZip.loadAsync(file.bytes)).files).some((path) => DOCX_PICTURE.test(path));
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
  return { text: lines.join("\n"), photo };
}

/** A photo sits on the first page of a CV: any picture there larger than an icon. */
async function pdfShowsPhoto(pdf: Awaited<ReturnType<typeof getDocumentProxy>>): Promise<boolean> {
  try {
    const images = await extractImages(pdf, 1);
    return images.some((image) => image.width >= MIN_PHOTO_PIXELS && image.height >= MIN_PHOTO_PIXELS);
  } catch {
    // A picture pdf.js cannot decode does not make the CV unreadable.
    return false;
  }
}
