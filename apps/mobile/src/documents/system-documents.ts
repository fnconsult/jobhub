import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Share } from "react-native";
import { webAppAddress, webAppHeaders } from "../web-app";
import type { DocumentDevice, DocumentFormat } from "./document-reader";

/** Each format's MIME type, for Android, and its Uniform Type Identifier, for iOS. */
const TYPES: Record<DocumentFormat, { mimeType: string; UTI: string }> = {
  pdf: { mimeType: "application/pdf", UTI: "com.adobe.pdf" },
  docx: { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", UTI: "org.openxmlformats.wordprocessingml.document" },
};

/**
 * The device's own reader and share sheet (ADR-0076, #695). A document is downloaded from the web app into the app's
 * cache, never elsewhere: the system's share sheet is where the person saves it in Fichiers or sends it by Mail. Its
 * PDF opens in Quick Look on iOS and in the PDF viewer the person has on Android (expo-file-system's preview).
 */
export const systemDocuments: DocumentDevice = {
  async download(path, fileName) {
    const file = await File.downloadFileAsync(webAppAddress(path), new File(Paths.cache, fileName), { headers: webAppHeaders(), idempotent: true });
    return file.uri;
  },

  view: (file, title) => new File(file).preview({ title, mimeType: TYPES.pdf.mimeType }),

  shareFile: (file, title, format) => Sharing.shareAsync(file, { ...TYPES[format], dialogTitle: title }),

  async shareText(title, subject, text) {
    // The subject goes where the receiving app takes one: Mail's « Objet ».
    await Share.share({ title: subject || title, message: text }, { subject, dialogTitle: title });
  },
};
