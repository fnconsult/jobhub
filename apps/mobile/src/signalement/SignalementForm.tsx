import { APP_DEVICE_HEADER, appDeviceHeader } from "@jobhub/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TextInput, View, useWindowDimensions } from "react-native";
import { useApi } from "../api/api";
import { appDevice } from "./app-device";
import { INTER, radius, space, type, useTheme } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";

/** The message's length, in characters, once trimmed, as the web app checks it (apps/web/src/signalements/values.ts). */
const MESSAGE_MIN_LENGTH = 10;
const MESSAGE_MAX_LENGTH = 2_000;
/** The types the Candidate chooses between; a Question comes only from « Poser la question à l'équipe ». */
const TYPES = ["bug", "idee"] as const;

/**
 * What the Signalement form opens on: a type chosen under the box (« Signaler un problème », « Proposer une idée »), or a
 * Question to the team after a reply that did not satisfy (ADR-0035), the question prefilled and sent with a copy of the
 * exchange, never a link to the Coach Conversation.
 */
export type SignalementStart = { kind: "type"; type: "bug" | "idee" } | { kind: "question"; question: string; coachReply: string };

/**
 * The system's text scale as the web's Text Size names it (the app has none of its own, ADR-0076): what a Signalement says
 * of how the person reads.
 */
export function textSizeOf(fontScale: number): "small" | "standard" | "large" | "xlarge" {
  if (fontScale < 0.95) return "small";
  if (fontScale < 1.15) return "standard";
  if (fontScale < 1.4) return "large";
  return "xlarge";
}

/**
 * The Signalement form, native (#690), in the Work Pane: its type (Bug or Idée) unless it is a Question, the message
 * (10 to 2,000 characters), and what goes with it, said before sending: the page, the app's version, the device, the
 * language and the text size; for a Question, the exchange too, and nothing else of the conversation. The version and
 * the device go in APP_DEVICE_HEADER, as the form shows them: a native fetch's user agent names neither, so the web app
 * keeps them in its place (« App Jobbbox 1.4.0, iOS 18.6 »). Read by the Jobbbox team, never by an AI (`POST /api/signalements`).
 */
export function SignalementForm({ start, path, onClose }: { start: SignalementStart; path: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const api = useApi();
  const { fontScale } = useWindowDimensions();
  const question = start.kind === "question" ? start : null;
  const [kind, setKind] = useState<"bug" | "idee">(start.kind === "type" ? start.type : "bug");
  const [text, setText] = useState(question?.question ?? "");
  const [problem, setProblem] = useState<"tooShort" | "failed" | "tooMany" | null>(null);
  const [working, setWorking] = useState(false);
  const [sent, setSent] = useState(false);
  const [detailShown, setDetailShown] = useState(false);
  const length = text.trim().length;
  const textSize = textSizeOf(fontScale);
  const sentFrom = appDevice();
  const version = sentFrom?.version;
  const device = sentFrom ? `${sentFrom.system} ${sentFrom.systemVersion}` : null;

  async function send() {
    if (working) return;
    if (length < MESSAGE_MIN_LENGTH) return setProblem("tooShort");
    setWorking(true);
    setProblem(null);
    const context = { message: text, path, textSize };
    const body = question ? { type: "question", ...context, attachedQuestion: question.question, attachedCoachReply: question.coachReply } : { type: kind, ...context };
    const headers = sentFrom ? { [APP_DEVICE_HEADER]: appDeviceHeader(sentFrom) } : undefined;
    const response = await api("/api/signalements", { method: "POST", body: JSON.stringify(body), ...(headers ? { headers } : {}) }).catch(() => null);
    setWorking(false);
    if (response?.ok) setSent(true);
    else setProblem(response?.status === 429 ? "tooMany" : "failed");
  }

  if (sent)
    return (
      <View style={{ gap: space[3] }}>
        <AppText weight="semiBold">{t("signalement.thanks")}</AppText>
        <AppText>{t("signalement.thanksDetail")}</AppText>
        <View style={{ alignSelf: "flex-start" }}>
          <Control label={t("signalement.close")} look="secondary" onPress={onClose} />
        </View>
      </View>
    );

  return (
    <View style={{ gap: space[4] }}>
      {question ? null : (
        <View role="radiogroup" aria-label={t("signalement.typeLegend")} style={{ flexDirection: "row", gap: space[2] }}>
          {TYPES.map((option) => (
            <Control key={option} label={t(`signalement.types.${option}`)} look="secondary" selected={kind === option} onPress={() => setKind(option)} />
          ))}
        </View>
      )}
      <View style={{ gap: space[1] }}>
        <AppText weight="semiBold">{question ? t("signalement.question.label") : t(`signalement.label.${kind}`)}</AppText>
        <TextInput
          aria-label={question ? t("signalement.question.label") : t(`signalement.label.${kind}`)}
          placeholder={question ? t("signalement.question.placeholder") : t(`signalement.placeholder.${kind}`)}
          placeholderTextColor={colors.meta}
          value={text}
          onChangeText={(next) => {
            setText(next);
            if (problem === "tooShort" && next.trim().length >= MESSAGE_MIN_LENGTH) setProblem(null);
          }}
          maxLength={MESSAGE_MAX_LENGTH}
          multiline
          style={{
            minHeight: 120,
            padding: space[3],
            borderWidth: 1,
            borderColor: colors.borderStrong,
            borderRadius: radius.control,
            fontFamily: INTER.regular,
            fontSize: type.fontSize.body,
            color: colors.text,
            backgroundColor: colors.surface,
            textAlignVertical: "top",
          }}
        />
        <AppText variant="meta" tone="secondary">
          {t("signalement.count", { count: length, max: MESSAGE_MAX_LENGTH })}
        </AppText>
        {problem === "tooShort" ? <AppText tone="danger">{t("signalement.tooShort", { min: MESSAGE_MIN_LENGTH })}</AppText> : null}
      </View>
      <View style={{ gap: space[2] }}>
        {question ? (
          <>
            <AppText>{t("signalement.question.attached")}</AppText>
            <AppText>{`• ${t("signalement.question.exchange")}`}</AppText>
            <AppText>{`• ${t("mobile.signalement.questionContext")}`}</AppText>
            <AppText>{t("signalement.question.nothingElse")}</AppText>
          </>
        ) : (
          <AppText>{t("mobile.signalement.notice")}</AppText>
        )}
        <View style={{ alignSelf: "flex-start" }}>
          <Control label={t(detailShown ? "signalement.hideDetail" : "signalement.showDetail")} look="quiet" expanded={detailShown} onPress={() => setDetailShown(!detailShown)} />
        </View>
        {detailShown ? (
          <View style={{ gap: space[1] }}>
            {question ? <Detail label={t("signalement.question.yourQuestion")} value={question.question} /> : null}
            {question ? <Detail label={t("signalement.question.coachReply")} value={question.coachReply} /> : null}
            <Detail label={t("signalement.detail.page")} value={path} />
            {version ? <Detail label={t("signalement.detail.version")} value={version} /> : null}
            {device ? <Detail label={t("mobile.signalement.device")} value={device} /> : null}
            <Detail label={t("signalement.detail.language")} value={t(`languages.${i18n.language === "en" ? "en" : "fr"}`)} />
            <Detail label={t("signalement.detail.textSize")} value={t(`textSize.${textSize}`)} />
          </View>
        ) : null}
        <AppText variant="meta" tone="secondary">
          {t("signalement.readBy")}
        </AppText>
      </View>
      {problem === "failed" || problem === "tooMany" ? (
        <View role="alert">
          <AppText tone="danger">{t(problem === "tooMany" ? "signalement.tooMany" : "signalement.failed")}</AppText>
        </View>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
        <Control label={working ? t("signalement.sending") : t("signalement.send")} look="primary" disabled={working} onPress={() => void send()} />
        <Control label={t("signalement.cancel")} look="secondary" onPress={onClose} />
      </View>
    </View>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <AppText variant="meta" tone="meta">
        {label}
      </AppText>
      <AppText>{value}</AppText>
    </View>
  );
}
