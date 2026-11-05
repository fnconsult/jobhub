import { formatDuration, formatTokens } from "@jobhub/shared";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AccessibilityInfo, View } from "react-native";
import { Conversation } from "../conversation/Conversation";
import { radius, space, useTheme } from "../theme/theme";
import { AppText } from "../ui/AppText";
import type { ConversationSummary, SubjectRef } from "./coach-reply";
import { useCoachConversation, type Announce, type ReplyStatus, type ShownMessage } from "./use-coach-conversation";

/**
 * Where a Coach Conversation is the page (ADR-0070), as the web's PagePlacement: `conversationId`, the saved one shown
 * (null: a new Free conversation, or a Subject's before its first message); `subject`, the object or Sidebar menu the
 * page is (its conversation is read by it, and its first message starts it); `route`, the page's address, sent with
 * each message; `introduction`, what its first message says after the AI disclosure; `card`, the menu's content, a card
 * in the thread that stays; `suggestions`, above the box while nothing is sent; `onSaved`, a new Free conversation's
 * first message saved it.
 */
export type PagePlacement = {
  conversationId: string | null;
  subject?: SubjectRef;
  route: string;
  introduction?: ReactNode;
  card?: ReactNode;
  suggestions?: ReactNode;
  onSaved?: (conversation: ConversationSummary) => void;
};

/**
 * A Coach Conversation, the page itself (ADR-0070, ADR-0076): the thread at its reading width, the AI disclosure first,
 * the Candidate's messages and the AI Coach's replies, the step under way while a reply comes (from the NDJSON stream),
 * « Réponse arrêtée » after « Arrêter », and why there is no reply, as on the web. VoiceOver and TalkBack hear a reply
 * once it is finished, never word by word: the thread is no live region, the reply is announced.
 */
export function CoachConversation(page: PagePlacement) {
  const { t, i18n } = useTranslation();
  const language = i18n.language === "en" ? "en" : "fr";
  const [draft, setDraft] = useState("");
  const failureText = (status: ReplyStatus) =>
    status.kind === "invalid"
      ? t("coachPanel.errors.invalid")
      : status.kind === "failed" && status.reason
        ? t("coachPanel.failed", { reason: t(`failureReasons.${status.reason}`) })
        : t("coachPanel.errors.unavailable");
  const announce: Announce = (outcome) =>
    AccessibilityInfo.announceForAccessibility(
      outcome.kind === "reply" ? t("mobile.coach.replyAnnounced", { reply: outcome.text }) : outcome.kind === "stopped" ? t("coachPanel.stopped") : failureText(outcome.status),
    );
  const coach = useCoachConversation({ conversationId: page.conversationId, ...(page.subject ? { subject: page.subject } : {}), route: page.route, ...(page.onSaved ? { onSaved: page.onSaved } : {}), announce });
  const sending = coach.status.kind === "sending";

  const send = async (text: string) => {
    setDraft("");
    if (!(await coach.send(text))) setDraft((typed) => typed || text);
  };

  return (
    <Conversation draft={draft} onDraftChange={setDraft} streaming={sending} onSend={(text) => void send(text)} onStop={coach.stop} onAttach={() => {}}>
      {coach.restoring ? (
        <AppText tone="secondary">{t("coachPanel.loading")}</AppText>
      ) : (
        <CoachSays>
          <AppText>{t(coach.aiDisclosure ? "coachPanel.aiDisclosure" : "coachPanel.welcome")}</AppText>
          {page.introduction}
        </CoachSays>
      )}
      {page.card}
      {coach.messages.map((message, index) => (
        <Message key={index} message={message} language={language} />
      ))}
      {coach.status.kind === "sending" ? (
        <AppText tone="secondary">{coach.status.live.step ? t(`aiActivity.steps.${coach.status.live.step.label}`) : t("coachPanel.thinking")}</AppText>
      ) : null}
      {coach.status.kind === "failed" || coach.status.kind === "invalid" ? <Notice>{failureText(coach.status)}</Notice> : null}
    </Conversation>
  );
}

/** What the AI Coach says, under the words « Coach IA »: it says it is an AI at every width (AI Act art. 50(1)). */
function CoachSays({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <View style={{ gap: space[1] }}>
      <AppText variant="meta" tone="meta">
        {t("coachPanel.badge")}
      </AppText>
      {children}
    </View>
  );
}

function Message({ message, language }: { message: ShownMessage; language: "fr" | "en" }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  if (message.from === "candidate")
    return (
      <View style={{ alignSelf: "flex-end", maxWidth: "85%", padding: space[3], borderRadius: radius.card * 1.6, backgroundColor: colors.accentSoft }}>
        {message.blocked ? (
          <AppText variant="meta" tone="danger">
            {t("coachPanel.blocked")}
          </AppText>
        ) : null}
        <AppText>{message.text}</AppText>
      </View>
    );
  if (message.from === "stopped")
    return (
      <CoachSays>
        <AppText tone="danger">{`${t("coachPanel.stopped")} · ${formatTokens(message.tokens, language)} ${t("provenanceLine.tokens")} · ${formatDuration(message.ms, language)}`}</AppText>
      </CoachSays>
    );
  return (
    <CoachSays>
      {message.blocked ? (
        <AppText variant="meta" tone="danger">
          {t("coachPanel.blocked")}
        </AppText>
      ) : null}
      <AppText>{message.text}</AppText>
    </CoachSays>
  );
}

function Notice({ children }: { children: string }) {
  const { colors } = useTheme();
  return (
    <View role="alert" style={{ padding: space[3], borderRadius: radius.card, backgroundColor: colors.dangerSoft }}>
      <AppText>{children}</AppText>
    </View>
  );
}
