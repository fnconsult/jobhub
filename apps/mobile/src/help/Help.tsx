import type { HelpArticle, HelpLocale } from "@jobhub/help";
import { helpForUnanswered, helpSuggestions, MIN_SUGGESTION_LENGTH, oftenAsked, onThisPage } from "@jobhub/help/coach-help";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AccessibilityInfo, Pressable, View } from "react-native";
import { radius, space, TARGET, useTheme } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";
import { usePointerHover } from "../ui/pointer";

/**
 * The help of the conversation's box (#342, ADR-0035), as on the web: Help Articles written by the Jobbbox team, bundled
 * with the app (`@jobhub/help`) and found without AI, so it works without network and costs nothing.
 */

/** How long the box waits for the Candidate to stop typing before it looks in the help. */
const SUGGEST_DELAY_MS = 150;

/** The Help Articles' language for the app's: English for English, French otherwise. */
export const helpLocaleOf = (language: string | undefined): HelpLocale => (language?.startsWith("en") ? "en" : "fr");

/**
 * The Help Articles matching the draft, once the Candidate pauses; none as soon as it is cleared or cut short. Their
 * number is said to VoiceOver and TalkBack when it changes, never moving the focus.
 */
export function useHelpSuggestions(draft: string, locale: HelpLocale): readonly HelpArticle[] {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQuery(draft), SUGGEST_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft]);
  const found = useMemo(() => helpSuggestions(query, locale), [query, locale]);
  const count = found.length;
  useEffect(() => {
    if (count > 0) AccessibilityInfo.announceForAccessibility(t("coachPanel.help.found", { count }));
  }, [count, t]);
  return draft.trim().length >= MIN_SUGGESTION_LENGTH ? found : [];
}

/** A button of the help: an article's title, as wide as it needs, 44 pt high at least. */
function HelpButton({ label, detail, onPress }: { label: string; detail?: string; onPress: () => void }) {
  const { colors } = useTheme();
  const { hovered, hoverProps } = usePointerHover();
  return (
    <Pressable
      role="button"
      aria-label={detail ? `${label}, ${detail}` : label}
      onPress={onPress}
      {...hoverProps}
      style={({ pressed }) => ({
        minHeight: TARGET,
        justifyContent: "center",
        paddingHorizontal: space[3],
        paddingVertical: space[1],
        borderRadius: radius.control,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: pressed || hovered ? colors.hover : colors.surface,
      })}
    >
      <AppText>{label}</AppText>
      {detail ? (
        <AppText variant="meta" tone="secondary">
          {detail}
        </AppText>
      ) : null}
    </Pressable>
  );
}

/** « Dans l'aide, sans IA »: the Help Articles matching what the Candidate is typing, above the box, each with its kind. */
export function HelpSuggestions({ articles, onOpen }: { articles: readonly HelpArticle[]; onOpen: (article: HelpArticle) => void }) {
  const { t } = useTranslation();
  if (articles.length === 0) return null;
  return (
    <View role="list" aria-label={t("coachPanel.help.suggestions")} style={{ gap: space[1], paddingBottom: space[1] }}>
      <AppText variant="meta" tone="meta" weight="semiBold">
        {t("coachPanel.help.suggestions")}
      </AppText>
      {articles.map((article) => (
        <HelpButton key={article.id} label={article.title} detail={t(`coachPanel.help.kinds.${article.kind}`)} onPress={() => onOpen(article)} />
      ))}
    </View>
  );
}

/** An article's text, its paragraphs apart. */
export function HelpText({ text }: { text: string }) {
  return (
    <View style={{ gap: space[3] }}>
      {text
        .split(/\n\s*\n/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
        .map((paragraph, index) => (
          <AppText key={index}>{paragraph.replace(/\*\*(.+?)\*\*/g, "$1")}</AppText>
        ))}
    </View>
  );
}

/**
 * A Help Article in the Work Pane (ADR-0070; full page below 64rem): never saved with the conversation, never sent to the
 * AI Coach (only its title, if the Candidate then asks). « Cela répond à votre question ? » thanks for « Oui »; « Non,
 * demander au coach » starts a question about it in the box.
 */
export function HelpArticleView({ article, onAskCoach }: { article: HelpArticle; onAskCoach: () => void }) {
  const { t } = useTranslation();
  const [answered, setAnswered] = useState(false);
  return (
    <View style={{ gap: space[4] }}>
      <AppText variant="meta" tone="meta">
        {t("coachPanel.help.cardLabel")}
      </AppText>
      <HelpText text={article.body} />
      {answered ? (
        <AppText>{t("coachPanel.help.thanks")}</AppText>
      ) : (
        <View role="group" aria-label={t("coachPanel.help.answered")} style={{ gap: space[2] }}>
          <AppText>{t("coachPanel.help.answered")}</AppText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
            <Control label={t("coachPanel.help.yes")} look="secondary" onPress={() => setAnswered(true)} />
            <Control label={t("coachPanel.help.no")} look="secondary" onPress={onAskCoach} />
          </View>
        </View>
      )}
    </View>
  );
}

/**
 * An empty conversation's help: « Comment marche cette page ? », the page's article (its Work Pane shows articles whole),
 * and « Souvent demandé », three frequent questions, unless the page has suggestions of its own (`oftenAsked` false).
 */
export function HelpIntro({ pathname, locale, onOpen, showOftenAsked }: { pathname: string; locale: HelpLocale; onOpen: (article: HelpArticle) => void; showOftenAsked: boolean }) {
  const { t } = useTranslation();
  const here = onThisPage(pathname, locale);
  const often = showOftenAsked ? oftenAsked(locale) : [];
  return (
    <View style={{ gap: space[2] }}>
      <AppText>{t("coachPanel.help.greeting")}</AppText>
      {here ? (
        <View style={{ alignSelf: "flex-start" }}>
          <Control label={t("conversationFirst.howThisPageWorks")} look="secondary" onPress={() => onOpen(here.article)} />
        </View>
      ) : null}
      {often.length > 0 ? (
        <View style={{ gap: space[1] }}>
          <AppText variant="meta" tone="meta" weight="semiBold">
            {t("coachPanel.help.oftenAsked")}
          </AppText>
          {often.map((article) => (
            <HelpButton key={article.id} label={article.title} onPress={() => onOpen(article)} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** With the AI Coach unavailable: « Voici ce que l'aide propose » for the question sent, and « Poser la question à l'équipe » (#345). */
export function HelpForUnanswered({
  question,
  locale,
  onOpen,
  onAskTeam,
}: {
  question: string;
  locale: HelpLocale;
  onOpen: (article: HelpArticle) => void;
  onAskTeam: () => void;
}) {
  const { t } = useTranslation();
  const found = helpForUnanswered(question, locale);
  return (
    <View style={{ gap: space[2] }}>
      <AppText>{t(found.length > 0 ? "coachPanel.help.unavailableHelp" : "coachPanel.help.noHelp")}</AppText>
      {found.map((article) => (
        <HelpButton key={article.id} label={article.title} onPress={() => onOpen(article)} />
      ))}
      <AppText>{t("coachPanel.team.unavailable")}</AppText>
      <View style={{ alignSelf: "flex-start" }}>
        <Control label={t("coachPanel.team.ask")} look="secondary" onPress={onAskTeam} />
      </View>
    </View>
  );
}

/**
 * Under an AI Coach reply (#345, ADR-0035): « Cela répond à votre question ? Oui / Non ». « Non » offers « Poser la question
 * à l'équipe »; « Oui » thanks. A reply the AI Coach marked as one it could not answer offers the team at once.
 */
export function ReplyFeedback({
  couldNotAnswer,
  satisfied,
  onAnswer,
  onAskTeam,
}: {
  couldNotAnswer: boolean;
  satisfied: boolean | undefined;
  onAnswer: (satisfied: boolean) => void;
  onAskTeam: () => void;
}) {
  const { t } = useTranslation();
  if (satisfied === true)
    return (
      <AppText variant="meta" tone="secondary">
        {t("coachPanel.team.thanks")}
      </AppText>
    );
  if (couldNotAnswer || satisfied === false)
    return (
      <View style={{ gap: space[1] }}>
        <AppText variant="meta" tone="secondary">
          {t(couldNotAnswer ? "coachPanel.team.couldNotAnswer" : "coachPanel.team.notSatisfied")}
        </AppText>
        <View style={{ alignSelf: "flex-start" }}>
          <Control label={t("coachPanel.team.ask")} look="quiet" onPress={onAskTeam} />
        </View>
      </View>
    );
  return (
    <View role="group" aria-label={t("coachPanel.team.answered")} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[1] }}>
      <AppText variant="meta" tone="secondary">
        {t("coachPanel.team.answered")}
      </AppText>
      <Control label={t("coachPanel.team.yes")} look="quiet" onPress={() => onAnswer(true)} />
      <Control label={t("coachPanel.team.no")} look="quiet" onPress={() => onAnswer(false)} />
    </View>
  );
}
