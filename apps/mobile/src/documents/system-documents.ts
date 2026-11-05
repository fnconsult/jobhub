import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Share } from "react-native";
import { appSession } from "../session/instance";
import { isOnWebApp, webAppAddress, webAppHeaders } from "../web-app";
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
 * into a folder of the app's cache, never elsewhere: the system's share sheet is where the person saves it in Fichiers
 * or sends it by Mail. Its PDF opens in Quick Look on iOS and in the PDF viewer the person has on Android
 * (expo-file-system's preview). The folder is deleted when the session ends (`forgetDocuments`).
 */
export const systemDocuments: DocumentDevice = {
  async download(path, fileName) {
    // The session's cookie goes to the web app alone: an address the read gives on any other host (absolute, or `//host`)
    // is refused before anything is asked or sent, and the screen says the download failed.
    const address = webAppAddress(path);
    if (!isOnWebApp(address)) throw new Error("A Tailored Document is downloaded from the web app alone");
    // The export routes answer only a signed-in Candidate: without its cookie, every download would be a 401.
    const headers = { ...webAppHeaders(), cookie: await appSession.cookie() };
    const folder = documentsFolder();
    folder.create({ intermediates: true, idempotent: true });
    const file = await File.downloadFileAsync(address, new File(folder, fileName), { headers, idempotent: true });
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
