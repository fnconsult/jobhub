import { formatDuration, formatTokens } from "@jobhub/shared";
import { createContext, useContext, useMemo, useRef, useState, type ComponentRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AccessibilityInfo, TextInput, View } from "react-native";
import type { HelpArticle } from "@jobhub/help";
import { Conversation } from "../conversation/Conversation";
import { HelpArticleView, HelpForUnanswered, HelpIntro, HelpSuggestions, helpLocaleOf, ReplyFeedback, useHelpSuggestions } from "../help/Help";
import { useWorkPane } from "../shell/Shell";
import { SignalementForm, type SignalementStart } from "../signalement/SignalementForm";
import { radius, space, useTheme } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";
import type { ConversationSummary, SubjectRef } from "./coach-reply";
import { ProposalCard } from "./ProposalCard";
import { ScoreSuggestion } from "./ScoreSuggestion";
import { useRegisterPageConversation } from "./page-conversation";
import { useCoachConversation, type Announce, type ReplyStatus, type ShownMessage } from "./use-coach-conversation";

/**
 * Where a Coach Conversation is the page (ADR-0070), as the web's PagePlacement: `conversationId`, the saved one shown
 * (null: a new Free conversation, or a Subject's before its first message); `subject`, the object or Sidebar menu the
 * page is (its conversation is read by it, and its first message starts it); `route`, the page's address, sent with
 * each message; `introduction`, what its first message says after the AI disclosure; `card`, the menu's content, a card
 * in the thread that stays; `suggestions`, above the box while nothing is sent; `lead`, the page's own view before the
 * thread, the conversation following it with its box at the foot (Recherches d'offres' Offer box, ADR-0090); `onSaved`,
 * a new Free conversation's first message saved it.
 */
export type PagePlacement = {
  conversationId: string | null;
  subject?: SubjectRef;
  route: string;
  introduction?: ReactNode;
  card?: ReactNode;
  suggestions?: ReactNode;
  lead?: ReactNode;
  onSaved?: (conversation: ConversationSummary) => void;
};

/** What a page's suggestions do with its conversation: put the focus in the box. */
const CoachBox = createContext<{ focus: () => void }>({ focus: () => {} });

/** The page's box, from a suggestion above it or a card in its thread. */
export const useCoachBox = () => useContext(CoachBox);

/**
 * A Coach Conversation, the page itself (ADR-0070, ADR-0076): the thread at its reading width, the AI disclosure first,
 * the Candidate's messages and the AI Coach's replies, the step under way while a reply comes (from the NDJSON stream),
 * « Réponse arrêtée » after « Arrêter », and why there is no reply, as on the web. VoiceOver and TalkBack hear a reply
 * once it is finished, never word by word: the thread is no live region, the reply is announced.
 *
 * Its latest Job Offer card still to process (a Job Offer link's, a Share capture's) suggests « Scorer contre mon profil »
 * above the box (#697).
 * The help comes first (ADR-0035): an empty conversation offers « Comment marche cette page ? » and « Souvent demandé »;
 * the Help Articles matching the draft take the suggestions' place above the box; an article opens in the Work Pane (full
 * page below 64rem) and its title goes with the next message. Under each reply, « Cela répond à votre question ? » and
 * its Coach proposals; under the box, the Signalement links, whose native form opens in the Work Pane.
 */
export function CoachConversation(page: PagePlacement) {
  const { t, i18n } = useTranslation();
  const language = i18n.language === "en" ? "en" : "fr";
  const locale = helpLocaleOf(i18n.language);
  const workPane = useWorkPane();
  const [draft, setDraft] = useState("");
  // The Help Article read last: its title goes with the next message only (#342).
  const [readArticle, setReadArticle] = useState<{ id: string; title: string } | null>(null);
  const found = useHelpSuggestions(draft, locale);
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
  const coach = useCoachConversation({
    conversationId: page.conversationId,
    ...(page.subject ? { subject: page.subject } : {}),
    route: page.route,
    ...(page.onSaved ? { onSaved: page.onSaved } : {}),
    announce,
  });
  const sending = coach.status.kind === "sending";
  useRegisterPageConversation({
    conversationId: coach.conversation?.id ?? null,
    live: coach.status.kind === "sending" ? coach.status.live : null,
    context: coach.context,
    repliesOnPage: coach.repliesOnPage,
    clear: coach.clear,
    stop: coach.stop,
  });
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const box = useMemo(() => ({ focus: () => input.current?.focus() }), []);
  const empty = !coach.restoring && coach.messages.length === 0;
  // The latest Job Offer card of the thread, while it is still to process: « Scorer contre mon profil » is suggested (#697).
  const offerToScore = coach.messages.flatMap((message) => (message.from === "coach" && message.jobOffer ? [message.jobOffer] : [])).at(-1);

  const send = async (text: string) => {
    setDraft("");
    const read = readArticle ?? undefined;
    if (await coach.send(text, read)) setReadArticle(null);
    else setDraft((typed) => typed || text);
  };
  /** « Non, demander au coach »: the box starts a question about the article, to finish and send. */
  const askAbout = (article: HelpArticle) => {
    workPane.close();
    setReadArticle({ id: article.id, title: article.title });
    setDraft(t("coachPanel.help.askAbout", { title: article.title }));
    input.current?.focus();
  };
  const openArticle = (article: HelpArticle) => {
    setReadArticle({ id: article.id, title: article.title });
    workPane.open({ title: article.title, content: <HelpArticleView article={article} onAskCoach={() => askAbout(article)} /> });
  };
  const openSignalement = (start: SignalementStart) =>
    workPane.open({
      title: t(start.kind === "question" ? "signalement.question.title" : "signalement.title"),
      content: <SignalementForm start={start} path={page.route} onClose={workPane.close} />,
    });
  const askTeam = (question: string, coachReply: string) => openSignalement({ kind: "question", question, coachReply });
  const intro = empty ? <HelpIntro pathname={page.route} locale={locale} onOpen={openArticle} showOftenAsked={page.suggestions === undefined} /> : null;

  return (
    <CoachBox.Provider value={box}>
      <Conversation
        draft={draft}
        onDraftChange={setDraft}
        streaming={sending}
        onSend={(text) => void send(text)}
        onStop={coach.stop}
        onAttach={() => {}}
        inputRef={input}
        lead={page.lead}
        // The help's articles, while the Candidate types, take the page's suggestions' place (shown until something is sent).
        aboveBox={
          found.length > 0 ? (
            <HelpSuggestions articles={found} onOpen={openArticle} />
          ) : empty ? (
            page.suggestions
          ) : offerToScore && !offerToScore.followed && !sending ? (
            <ScoreSuggestion key={offerToScore.id} jobOfferId={offerToScore.id} />
          ) : null
        }
        belowBox={<SignalementLinks onOpen={openSignalement} />}
      >
        {coach.restoring ? (
          <AppText tone="secondary">{t("coachPanel.loading")}</AppText>
        ) : (
          <CoachSays>
            <AppText>{t(coach.aiDisclosure ? "coachPanel.aiDisclosure" : "coachPanel.welcome")}</AppText>
            {page.introduction}
            {page.card ? null : intro}
          </CoachSays>
        )}
        {/* A menu's content, a card after the Introduction: it stays whatever is sent; the help comes after it. */}
        {page.card}
        {page.card && intro ? <CoachSays>{intro}</CoachSays> : null}
        {coach.messages.map((message, index) => (
          <View key={index} style={{ gap: space[2] }}>
            <Message message={message} language={language} />
            {message.from === "coach" && message.cards?.length
              ? message.cards.map((card) => <ProposalCard key={card.id} card={card} onChange={(changed) => coach.cardChanged(index, changed)} />)
              : null}
            {message.from === "coach" && !message.blocked && !message.jobOffer ? (
              <ReplyFeedback
                couldNotAnswer={message.couldNotAnswer === true}
                satisfied={message.satisfied}
                onAnswer={(satisfied) => coach.answerFeedback(index, satisfied)}
                onAskTeam={() => askTeam(questionBefore(coach.messages, index), message.text)}
              />
            ) : null}
          </View>
        ))}
        {coach.status.kind === "sending" ? (
          <AppText tone="secondary">{coach.status.live.step ? t(`aiActivity.steps.${coach.status.live.step.label}`) : t("coachPanel.thinking")}</AppText>
        ) : null}
        {coach.status.kind === "failed" || coach.status.kind === "invalid" ? <Notice>{failureText(coach.status)}</Notice> : null}
        {/* The help still answers when the AI Coach cannot (ADR-0035), and the team, directly (#345). */}
        {coach.status.kind === "failed" ? (
          <HelpForUnanswered
            question={coach.status.question}
            locale={locale}
            onOpen={openArticle}
            onAskTeam={() => coach.status.kind === "failed" && askTeam(coach.status.question, failureText(coach.status))}
          />
        ) : null}
      </Conversation>
    </CoachBox.Provider>
  );
}

const REPORT_PROBLEM: SignalementStart = { kind: "type", type: "bug" };
const SUGGEST_IDEA: SignalementStart = { kind: "type", type: "idee" };

/** Under the box: « Signaler un problème » and « Proposer une idée », whose form opens in the Work Pane. */
function SignalementLinks({ onOpen }: { onOpen: (start: SignalementStart) => void }) {
  const { t } = useTranslation();
  return (
    <View role="group" aria-label={t("coachPanel.team.foot")} style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: space[2] }}>
      <Control label={t("coachPanel.team.reportProblem")} look="quiet" onPress={() => onOpen(REPORT_PROBLEM)} />
      <Control label={t("coachPanel.team.suggestIdea")} look="quiet" onPress={() => onOpen(SUGGEST_IDEA)} />
    </View>
  );
}

/** The Candidate's message an AI Coach reply answers: the one just before it. */
function questionBefore(messages: readonly ShownMessage[], index: number): string {
  for (let at = index - 1; at >= 0; at--) {
    const message = messages[at]!;
    if (message.from === "candidate") return message.text;
    if (message.from === "coach") break;
  }
  return "";
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
      {message.jobOffer ? (
        <AppText weight="semiBold">{`${t("coachPanel.jobOfferLink.card")} · ${[message.jobOffer.title, message.jobOffer.employer].filter(Boolean).join(" · ")} · ${t(message.jobOffer.followed ? "coachPanel.jobOfferLink.followed" : "coachPanel.jobOfferLink.toProcess")}`}</AppText>
      ) : null}
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
