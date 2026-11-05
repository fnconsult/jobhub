import { contextBar, formatTokens } from "@jobhub/shared";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { radius, space, useTheme } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";
import { useConfirmClear } from "./ClearConversation";
import { usePageConversation } from "./page-conversation";

/**
 * Activité (ADR-0070), the column or full page the Top Bar's « Activité » opens beside a conversation that has no
 * object: the Context bar, then AI Activity, the reply on its way (its step, « Arrêter ») and the replies given here.
 */
export function ActivityPane() {
  return (
    <View style={{ gap: space[6] }}>
      <ContextBar />
      <AiActivity />
    </View>
  );
}

/**
 * The Context bar (#607): the conversation's messages out of the 40 the AI Coach reads and the jetons of its context out
 * of the ceiling, as the server said them with its latest reply; empty before the first message. From 80 %, it says the
 * AI Coach reads only the latest messages and offers « Effacer la conversation », after the same Dialog as « Effacer ».
 */
function ContextBar() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const page = usePageConversation();
  const confirmClear = useConfirmClear();
  const language = i18n.language === "en" ? "en" : "fr";
  const bar = contextBar(page?.context ?? null);
  const percent = Math.round(bar.share * 100);
  const figures = t("contextBar.figures", {
    messages: bar.messages,
    maxMessages: bar.maxMessages ?? t("contextBar.unlimited"),
    tokens: formatTokens(bar.tokens, language),
    maxTokens: bar.maxTokens === null ? t("contextBar.unlimited") : formatTokens(bar.maxTokens, language),
  });
  return (
    <View style={{ gap: space[2] }}>
      <AppText weight="semiBold">{t("contextBar.title")}</AppText>
      <View
        accessible
        role="progressbar"
        aria-label={t("contextBar.title")}
        accessibilityValue={{ min: 0, max: 100, now: percent, text: figures }}
        style={{ height: 8, borderRadius: radius.control, backgroundColor: colors.hover, overflow: "hidden" }}
      >
        <View style={{ width: `${percent}%`, height: "100%", backgroundColor: bar.nearlyFull ? colors.warn : colors.accent }} />
      </View>
      <AppText variant="meta" tone="secondary">
        {figures}
      </AppText>
      {bar.nearlyFull ? (
        <View style={{ gap: space[2] }}>
          <AppText>{t("contextBar.nearlyFull")}</AppText>
          {confirmClear ? <Control label={t("contextBar.clear")} look="secondary" onPress={confirmClear} /> : null}
        </View>
      ) : null}
    </View>
  );
}

/** AI Activity (#314, #333): the AI Coach's reply on its way, then each reply given on this page, its models and tokens. */
function AiActivity() {
  const { t, i18n } = useTranslation();
  const page = usePageConversation();
  const language = i18n.language === "en" ? "en" : "fr";
  const time = new Intl.DateTimeFormat(i18n.language, { timeStyle: "short", timeZone: "Europe/Paris" });
  const live = page?.live ?? null;
  const replies = page?.repliesOnPage ?? [];
  return (
    <View style={{ gap: space[2] }}>
      <AppText weight="semiBold">{t("aiActivity.label")}</AppText>
      {live ? (
        <View style={{ gap: space[1] }}>
          <AppText>{`${t("aiActivity.kinds.coach_reply")} · ${live.step ? t(`aiActivity.steps.${live.step.label}`) : t("aiActivity.live.starting")}`}</AppText>
          <Control label={t("aiActivity.live.stop.coach_reply")} look="secondary" onPress={() => page?.stop()} />
        </View>
      ) : null}
      {!live && replies.length === 0 ? <AppText tone="secondary">{t("aiActivity.noAi")}</AppText> : null}
      {replies.map((reply, index) => {
        const models = (reply.provenance?.steps ?? []).flatMap((step) =>
          step.kind === "ai"
            ? [
                `${step.model ?? t("aiActivity.modelNotRecorded")} · ${t("aiActivity.tokens", { tokens: formatTokens(step.tokens ? step.tokens.input + step.tokens.output : 0, language) })}`,
              ]
            : [],
        );
        return (
          <View key={index} style={{ gap: space[1] }}>
            <AppText>{`${t("aiActivity.kinds.coach_reply")} · ${time.format(new Date(reply.at))}`}</AppText>
            {models.map((model, at) => (
              <AppText key={at} variant="meta" tone="secondary">
                {model}
              </AppText>
            ))}
          </View>
        );
      })}
    </View>
  );
}
