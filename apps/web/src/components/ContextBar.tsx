"use client";

import { useId } from "react";
import { useTranslation } from "react-i18next";
import { formatTokens } from "@jobhub/shared";
import { contextBar } from "@/coach/conversation";
import { ClearConversationButton, useConversationFirst } from "@/components/conversation-first";

/**
 * The Context bar (#607, ADR-0070), in Activité: how much of the page's Coach Conversation the AI Coach reads, its
 * messages out of the 40 it reads and the jetons of its context out of the ceiling, as the server last said them (the
 * estimate the context was sent with); empty before the conversation's first message. From 80 %, it says the AI Coach
 * reads only the latest messages and offers « Effacer la conversation », after the same confirming Dialog as « Effacer ».
 * Nothing on a page without a conversation.
 */
export function ContextBar() {
  const { t, i18n } = useTranslation();
  const page = useConversationFirst()?.page;
  const titleId = useId();
  if (!page) return null;
  const language = i18n.language === "en" ? "en" : "fr";
  const bar = contextBar(page.context);
  const percent = Math.round(bar.share * 100);
  const figures = t("contextBar.figures", {
    messages: bar.messages,
    maxMessages: bar.maxMessages,
    tokens: formatTokens(bar.tokens, language),
    maxTokens: formatTokens(bar.maxTokens, language),
  });
  return (
    <div className="context-bar" role="group" aria-labelledby={titleId} data-nearly-full={bar.nearlyFull || undefined}>
      <p id={titleId} className="context-bar-title">
        {t("contextBar.title")}
      </p>
      <div className="context-bar-track" role="meter" aria-labelledby={titleId} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={figures}>
        <span style={{ width: `${percent}%` }} />
      </div>
      <p className="context-bar-figures">{figures}</p>
      {bar.nearlyFull ? (
        <p className="context-bar-warning">
          {t("contextBar.nearlyFull")} <ClearConversationButton inContextBar />
        </p>
      ) : null}
    </div>
  );
}
