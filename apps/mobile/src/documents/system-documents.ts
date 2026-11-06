import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Share } from "react-native";
import { appFetch, appSession } from "../session/instance";
import { fetchOnWebApp, webAppAddress, webAppHeaders } from "../web-app";
import type { DocumentDevice, DocumentFormat } from "./document-reader";

/** Each format's MIME type, for Android, and its Uniform Type Identifier, for iOS. */
const TYPES: Record<DocumentFormat, { mimeType: string; UTI: string }> = {
  pdf: { mimeType: "application/pdf", UTI: "com.adobe.pdf" },
  docx: { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", UTI: "org.openxmlformats.wordprocessingml.document" },
};

/** The folder of the app's cache the documents are downloaded into, and deleted with when the session ends. */
const documentsFolder = () => new Directory(Paths.cache, "documents");

/**
 * The device's own reader and share sheet (ADR-0076, #695). A document is downloaded from the web app, with the session,
 * into a folder of the app's cache (one per Application and document, #756), never elsewhere: the system's share sheet is where the person saves it in Fichiers
 * or sends it by Mail. Its PDF opens in Quick Look on iOS and in the PDF viewer the person has on Android
 * (expo-file-system's preview). The folder is deleted when the session ends (`forgetDocuments`).
 */
export const systemDocuments: DocumentDevice = {
  async download(path, { folder, fileName }) {
    // The export routes answer only a signed-in Candidate: without its cookie, every download would be a 401.
    const headers = { ...webAppHeaders(), cookie: await appSession.cookie() };
    // The session's cookie goes to the web app alone (fetchOnWebApp): an address the read gives on any other host
    // (absolute, or `//host`), or a redirect leading to one (#756), is refused before anything is sent there, and the
    // screen says the download failed. The system's downloader would follow a redirect anywhere, the cookie with it.
    const response = await fetchOnWebApp(appFetch, webAppAddress(path), { headers, credentials: "omit" });
    if (!response.ok) throw new Error(`The download of a Tailored Document was answered ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    // Each Application's document in a folder of its own (document-reader.ts): a newer version replaces the file there.
    const into = new Directory(documentsFolder(), folder);
    into.create({ intermediates: true, idempotent: true });
    const file = new File(into, fileName);
    file.create({ overwrite: true });
    await file.write(bytes);
    return file.uri;
  },

  view: (file, title) => new File(file).preview({ title, mimeType: TYPES.pdf.mimeType }),

  shareFile: (file, title, format) => Sharing.shareAsync(file, { ...TYPES[format], dialogTitle: title }),

  async shareText(title, subject, text) {
    // The subject goes where the receiving app takes one: Mail's « Objet ».
    await Share.share({ title: subject || title, message: text }, { subject, dialogTitle: title });
  },
};

/**
 * Deletes every Tailored Document downloaded into the cache: signed out, or the session found revoked or expired, the
 * device keeps nothing of them (docs/privacy/register.md).
 */
export async function forgetDocuments(): Promise<void> {
  const folder = documentsFolder();
  if (folder.exists) folder.delete();
}
