import type { TailoredDocumentsResponse } from "@jobhub/shared/reads";
import type { TFunction } from "i18next";
import { FileText, Mail } from "lucide-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { useWorkPane } from "../shell/Shell";
import { radius, space, TARGET, useTheme } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";
import type { DocumentFormat, DocumentName, DocumentReader, TailoredDocument } from "./document-reader";

const NAMES = { tailored_cv: "tailoredCv.tailored", cover_letter: "tailoredDocuments.coverLetter.title", outreach_message: "tailoredDocuments.outreachMessage.title" } as const;

const changedOn = (document: TailoredDocument, t: TFunction, locale: string) =>
  t("mobile.documents.updatedOn", { date: new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "Europe/Paris" }).format(new Date(document.updatedAt)) });

/**
 * An Application's Tailored Documents on its Fiche (#695): its Tailored CV, its Cover Letter, its Outreach Message.
 * Each opens in the Work Pane, a file's PDF at once in the system's reader; there, « Partager » and « Télécharger » go
 * through the system's share sheet. Nothing here changes a document: that is done on jobbbox.ai (ADR-0076).
 */
export function TailoredDocuments({ documents, about, reader }: { documents: TailoredDocumentsResponse; about: string; reader: DocumentReader }) {
  const { t, i18n } = useTranslation();
  const workPane = useWorkPane();

  async function open(document: TailoredDocument) {
    const name = { name: t(NAMES[document.kind]), about };
    const show = (failed: boolean) => workPane.open({ title: name.name, content: <DocumentPane key={String(failed)} document={document} name={name} reader={reader} failed={failed} /> });
    show(false);
    try {
      await reader.read(document, name);
    } catch {
      show(true);
    }
  }

  return (
    <View style={{ gap: space[2] }}>
      <AppText variant="h3">{t("mobile.documents.title")}</AppText>
      {documents.documents.length === 0 ? <AppText tone="secondary">{t("mobile.documents.none")}</AppText> : null}
      {documents.documents.map((document) => (
        <DocumentRow key={document.kind} name={t(NAMES[document.kind])} meta={`${t(`tailoredDocuments.writtenIn.${document.language}`)} ${changedOn(document, t, i18n.language)}`} message={document.message !== null} onPress={() => void open(document)} />
      ))}
    </View>
  );
}

function DocumentRow({ name, meta, message, onPress }: { name: string; meta: string; message: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const Icon = message ? Mail : FileText;
  return (
    <Pressable
      role="button"
      aria-label={name}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: TARGET,
        flexDirection: "row",
        alignItems: "center",
        gap: space[3],
        padding: space[3],
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: pressed ? colors.hover : "transparent",
      })}
    >
      <Icon color={colors.secondary} size={22} aria-hidden />
      <View style={{ flex: 1 }}>
        <AppText weight="semiBold">{name}</AppText>
        <AppText variant="meta" tone="meta">
          {meta}
        </AppText>
      </View>
    </Pressable>
  );
}

/** A Tailored Document in the Work Pane: a file, to open again in the reader, share or download; a message, its words to share. */
function DocumentPane({ document, name, reader, failed: initiallyFailed }: { document: TailoredDocument; name: DocumentName; reader: DocumentReader; failed: boolean }) {
  const { t, i18n } = useTranslation();
  const [failed, setFailed] = useState(initiallyFailed);
  const attempt = (action: () => Promise<void>) => () => {
    setFailed(false);
    action().catch(() => setFailed(true));
  };
  const download = (format: DocumentFormat) => attempt(() => reader.download(document, name, format));
  const [downloadPdf, downloadWord] = (["pdf", "docx"] as const).map(download);

  return (
    <View style={{ gap: space[4] }}>
      <AppText tone="secondary">{`${t(`tailoredDocuments.writtenIn.${document.language}`)} ${changedOn(document, t, i18n.language)}`}</AppText>
      {document.message ? (
        <View style={{ gap: space[2] }}>
          {document.message.subject ? <AppText weight="semiBold">{t("mobile.documents.subject", { subject: document.message.subject })}</AppText> : null}
          <AppText>{document.message.text}</AppText>
        </View>
      ) : null}
      {failed ? <AppText tone="danger">{t("mobile.documents.failed")}</AppText> : null}
      <View style={{ gap: space[2] }}>
        {document.downloads ? <Control label={t("mobile.documents.open")} look="primary" onPress={attempt(() => reader.read(document, name))} /> : null}
        <Control label={t("mobile.documents.share")} look="secondary" onPress={attempt(() => reader.share(document, name))} />
        {document.downloads ? (
          <>
            <Control label={t("tailoredDocuments.aside.downloadPdf")} look="secondary" onPress={downloadPdf!} />
            <Control label={t("tailoredDocuments.aside.downloadWord")} look="secondary" onPress={downloadWord!} />
          </>
        ) : null}
      </View>
      <AppText variant="meta" tone="meta">
        {t("mobile.documents.readOnly")}
      </AppText>
    </View>
  );
}
