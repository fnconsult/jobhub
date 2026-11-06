import type { TailoredDocumentsResponse } from "@jobhub/shared/reads";

/** One of an Application's Tailored Documents, as `GET /api/applications/:id/documents` gives it (#684). */
export type TailoredDocument = TailoredDocumentsResponse["documents"][number];

/** The forms a Tailored Document's file is downloaded in. */
export type DocumentFormat = "pdf" | "docx";

/** What the device does with a document's file (system-documents.ts on a phone or a tablet). */
export interface DocumentDevice {
  /**
   * Downloads `path` (an `/api/*` route of the web app) into the app's cache, in its `folder` of the documents' folder,
   * as `fileName`, over what is there; answers the file's address.
   */
  download(path: string, place: CachePlace): Promise<string>;
  /** Shows a PDF in the system's reader: Quick Look on iOS, the PDF viewer on Android. */
  view(file: string, title: string): Promise<void>;
  /** The system's share sheet with a file in `format` (Fichiers, Mail…). */
  shareFile(file: string, title: string, format: DocumentFormat): Promise<void>;
  /** The system's share sheet with a text and its subject (empty for none). */
  shareText(title: string, subject: string, text: string): Promise<void>;
}

/** Where a document's file lands in the documents' folder of the app's cache: a folder, a file name. */
export type CachePlace = { folder: string; fileName: string };

/**
 * Whose document it is, its Application's id, and how it is named: « CV adapté », and what it is for, « Aéroline ·
 * Responsable qualité ». Two Applications can be named alike (the same Job Offer under two Profiles): the id keeps their
 * files apart (#756).
 */
export type DocumentName = { applicationId: string; name: string; about: string };

/**
 * An Application's Tailored Documents as the app shows them (ADR-0076, #695): to read, share and download, never to
 * change. A file is always shown as its PDF, a Word document included (ADR-0067); the Outreach Message, which is not a
 * file, is shared as its words. Each failure rejects, for the screen to say so; a file is downloaded once per version.
 */
export interface DocumentReader {
  /** Shows the document's PDF in the system's reader. A message has no file: nothing happens. */
  read(document: TailoredDocument, name: DocumentName): Promise<void>;
  /** The system's share sheet with the document: its PDF, or a message's subject and text. */
  share(document: TailoredDocument, name: DocumentName): Promise<void>;
  /** The system's share sheet with the document's file in `format`, to save it in Fichiers or send it. */
  download(document: TailoredDocument, name: DocumentName, format: DocumentFormat): Promise<void>;
}

/** A name the device accepts for a file or a folder: no path separator or reserved character. */
const safe = (name: string) => name.replace(/[/\\:*?"<>|]+/g, "-");

/**
 * Where a document's file is kept: a folder of its own, named for its Application and its kind (`app_1-tailored_cv`),
 * so no other Application's document lands in it; the file named as a person reads it in the share sheet or in
 * Fichiers, « CV adapté – Aéroline · Responsable qualité.pdf », in its format.
 */
const placeOf = (document: TailoredDocument, { applicationId, name, about }: DocumentName, format: DocumentFormat): CachePlace => ({
  folder: safe(`${applicationId}-${document.kind}`),
  fileName: `${safe(`${name} – ${about}`)}.${format}`,
});

export function createDocumentReader(device: DocumentDevice): DocumentReader {
  const files = new Map<string, Promise<string>>();

  /** The document's file in `format`, downloaded the first time it is asked for in this version. */
  function file(document: TailoredDocument, name: DocumentName, format: DocumentFormat): Promise<string> | null {
    if (!document.downloads) return null;
    const path = document.downloads[format];
    const key = `${path} ${document.updatedAt}`;
    let downloaded = files.get(key);
    if (!downloaded) {
      downloaded = device.download(path, placeOf(document, name, format));
      files.set(key, downloaded);
      // A failed download is tried again the next time.
      downloaded.catch(() => files.delete(key));
    }
    return downloaded;
  }

  return {
    async read(document, name) {
      const pdf = file(document, name, "pdf");
      if (pdf) await device.view(await pdf, name.name);
    },

    async share(document, name) {
      if (document.message) return device.shareText(name.name, document.message.subject, document.message.text);
      const pdf = file(document, name, "pdf");
      if (pdf) await device.shareFile(await pdf, name.name, "pdf");
    },

    async download(document, name, format) {
      const downloaded = file(document, name, format);
      if (downloaded) await device.shareFile(await downloaded, name.name, format);
    },
  };
}
