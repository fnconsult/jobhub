import { formatTimeOfDay } from "@jobhub/shared";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import { useRouter } from "expo-router";
import { useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { useApi } from "../api/api";
import { paths } from "../navigation/pages";
import { useWorkPane } from "../shell/Shell";
import { radius, space, useTheme } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";
import { SessionWebPage } from "../web-pages/WebPageScreen";
import { attachmentOfDrop, attachmentOfFile, linkIn, type Attachment, type DroppedItem } from "./attachment";
import { createProfile, readCv, type CvDraft, type CvReadingError } from "./cv-draft";

/** What the document picker offers: PDF and Word files (.docx), as the web's form accepts them. */
const CV_TYPES = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];

/** The web's page creating a Profile, where a draft the server finds incomplete is completed. */
const NEW_PROFILE_ON_WEB = "/profils/nouveau";

type Shown =
  | { kind: "none" }
  | { kind: "notice"; text: string }
  | { kind: "reading"; name: string; stop: () => void }
  | { kind: "stopped"; at: Date }
  | { kind: "read"; name: string; draft: CvDraft; creating: boolean; problem: "incomplete" | "quotaReached" | "failed" | null; fields?: string[] };

/** What the conversation's « + » and its box hand on, and what the thread shows of it. */
export type Attach = {
  /** « Coller un lien d'offre »: the clipboard's link. */
  pasteLink: () => void;
  /** « Joindre un CV »: the system's document picker. */
  pickCv: () => void;
  /** Something dropped on the box, on a tablet. */
  drop: (items: DroppedItem[]) => void;
  /** In the thread: the CV being read and what was read, or why nothing was taken. */
  shown: ReactNode;
};

/**
 * « + » in the conversation's box (ADR-0076, #696) and what is dropped on it on a tablet, which does the same.
 *
 * - The link of a Job Offer is handed to `onJobOfferLink`. Until the Share capture (#697) takes it, its caller sends it
 *   as a message, which the server reads as a Job Offer.
 * - A CV (PDF, DOCX) is refused at once when over 10 MB or of another format (ADR-0068), and otherwise read by
 *   `POST /api/cv/draft` as the web's form reads it, « Arrêter » meanwhile; the server decides. What it read shows in
 *   the thread, saved as a new Profile by « Créer le profil », which then opens. A draft the server finds incomplete is
 *   finished on jobbbox.ai. Nothing is saved before « Créer le profil ».
 */
export function useAttach({ onJobOfferLink }: { onJobOfferLink: (url: string) => void | Promise<void> }): Attach {
  const { t } = useTranslation();
  const api = useApi();
  const [shown, setShown] = useState<Shown>({ kind: "none" });
  // The reading under way: a new one, or « Arrêter », leaves its outcome unshown.
  const reading = useRef<AbortController | null>(null);

  const readingError = (error: CvReadingError) => t(`cvUpload.errors.${error}`);

  const attach = async (attachment: Attachment) => {
    if (attachment.kind === "nothing") return setShown({ kind: "notice", text: t("mobile.attachments.nothingDropped") });
    if (attachment.kind === "jobOfferLink") {
      setShown({ kind: "none" });
      return void (await onJobOfferLink(attachment.url));
    }
    if (attachment.kind === "refused") return setShown({ kind: "notice", text: readingError(attachment.problem) });
    reading.current?.abort();
    const controller = new AbortController();
    reading.current = controller;
    const { file } = attachment;
    setShown({ kind: "reading", name: file.name, stop: () => controller.abort() });
    const outcome = await readCv(api, file, { signal: controller.signal });
    if (reading.current !== controller) return;
    reading.current = null;
    if (outcome.kind === "draft") setShown({ kind: "read", name: file.name, draft: outcome.draft, creating: false, problem: null });
    else if (outcome.kind === "stopped") setShown({ kind: "stopped", at: new Date() });
    else setShown({ kind: "notice", text: readingError(outcome.error) });
  };

  const pickCv = async () => {
    const picked = await DocumentPicker.getDocumentAsync({ type: CV_TYPES, copyToCacheDirectory: true, multiple: false }).catch(() => null);
    const file = picked && !picked.canceled ? picked.assets?.[0] : undefined;
    if (!file) return;
    await attach(attachmentOfFile({ uri: file.uri, name: file.name, size: file.size ?? null, mimeType: file.mimeType ?? null }));
  };

  const pasteLink = async () => {
    const url = linkIn(await Clipboard.getStringAsync().catch(() => ""));
    if (url) await attach({ kind: "jobOfferLink", url });
    else setShown({ kind: "notice", text: t("mobile.attachments.noLink") });
  };

  return {
    pasteLink: () => void pasteLink(),
    pickCv: () => void pickCv(),
    drop: (items) => void attach(attachmentOfDrop(items)),
    shown: <Shown shown={shown} onChange={setShown} />,
  };
}

function Shown({ shown, onChange }: { shown: Shown; onChange: (shown: Shown) => void }) {
  const { t, i18n } = useTranslation();
  if (shown.kind === "none") return null;
  if (shown.kind === "notice") return <Notice>{shown.text}</Notice>;
  if (shown.kind === "reading")
    return (
      <Card>
        <AppText tone="secondary">{t("cvUpload.reading")}</AppText>
        <Control label={t("coachPanel.stop")} accessibleName={t("aiActivity.live.stop.cv_reading")} look="secondary" onPress={shown.stop} />
      </Card>
    );
  if (shown.kind === "stopped")
    return (
      <Card>
        <AppText tone="secondary">{t("cvUpload.stopped", { time: formatTimeOfDay(shown.at, new Date(), i18n.language === "en" ? "en" : "fr") })}</AppText>
      </Card>
    );
  return <ReadCv read={shown} onChange={onChange} />;
}

/** What was read in the CV, and « Créer le profil », which saves it as a Profile and opens it. */
function ReadCv({ read, onChange }: { read: Extract<Shown, { kind: "read" }>; onChange: (shown: Shown) => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const router = useRouter();
  const workPane = useWorkPane();
  const { masterCv, searchCriteria } = read.draft;
  const fieldLabels: Record<string, string> = { "searchCriteria.targetRole": t("cvReview.targetRole"), "searchCriteria.locations": t("cvReview.locations") };
  const named = (read.fields ?? []).map((field) => fieldLabels[field]).filter(Boolean);

  const create = async () => {
    onChange({ ...read, creating: true, problem: null });
    const outcome = await createProfile(api, read.draft);
    if (outcome.kind === "created") {
      onChange({ kind: "none" });
      router.push(paths.profile(outcome.id));
    } else onChange({ ...read, creating: false, problem: outcome.kind, ...(outcome.kind === "incomplete" ? { fields: outcome.fields } : {}) });
  };
  const createOnWeb = () => workPane.open({ title: t("mobile.attachments.newProfile"), fill: true, content: <SessionWebPage path={NEW_PROFILE_ON_WEB} /> });

  return (
    <Card>
      <AppText weight="semiBold">{t("mobile.attachments.read", { name: read.name })}</AppText>
      {[masterCv.fullName, masterCv.headline].filter((line) => line?.trim()).length ? (
        <AppText>{[masterCv.fullName, masterCv.headline].filter((line) => line?.trim()).join(" · ")}</AppText>
      ) : null}
      {searchCriteria.targetRole.trim() ? <AppText tone="secondary">{t("mobile.attachments.targetRole", { value: searchCriteria.targetRole })}</AppText> : null}
      {searchCriteria.locations.length ? <AppText tone="secondary">{t("mobile.attachments.locations", { value: searchCriteria.locations.join(", ") })}</AppText> : null}
      {read.problem === "incomplete" ? (
        <>
          <Notice>{t("mobile.attachments.incomplete", { fields: named.length ? named.join(", ") : t("mobile.attachments.incompleteFields") })}</Notice>
          <Control label={t("mobile.attachments.createOnWeb")} look="secondary" onPress={createOnWeb} />
        </>
      ) : (
        <>
          {read.problem === "quotaReached" ? <Notice>{`${t("profiles.quotaReached")} ${t("mobile.subscriptionOnWeb")}`}</Notice> : null}
          {read.problem === "failed" ? <Notice>{t("cvReview.error")}</Notice> : null}
          <Control
            label={read.creating ? t("mobile.attachments.creating") : t("mobile.attachments.createProfile")}
            look="primary"
            disabled={read.creating}
            onPress={() => void create()}
          />
          <AppText variant="meta" tone="secondary">
            {t("mobile.attachments.editLater")}
          </AppText>
        </>
      )}
    </Card>
  );
}

function Card({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return <View style={{ gap: space[2], padding: space[3], borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, alignItems: "flex-start" }}>{children}</View>;
}

function Notice({ children }: { children: string }) {
  const { colors } = useTheme();
  return (
    <View role="alert" style={{ padding: space[3], borderRadius: radius.card, backgroundColor: colors.dangerSoft }}>
      <AppText>{children}</AppText>
    </View>
  );
}
