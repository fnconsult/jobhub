"use client";

import { useId } from "react";
import { useTranslation } from "react-i18next";
import { formatTokens } from "@jobhub/shared";
import { contextBar, contextBreakdown, type ConversationContext } from "@/coach/conversation";
import { ClearConversationButton, useConversationFirst } from "@/components/conversation-first";
import { buttonClass } from "@/design/button-class";
import { Drawer } from "@/design/Drawer";
import { routes } from "@/routes";

/**
 * The Context bar (#607, ADR-0070), in Activité: how much of the page's Coach Conversation the AI Coach reads, its
 * messages out of those it reads and the jetons of its context out of the ceiling, the Coach context limits of the
 * Candidate's Plan (ADR-0078; « illimité » when unlimited), as the server last said them (the
 * estimate the context was sent with); empty before the conversation's first message. From 80 %, it says the AI Coach
 * reads only the latest messages and offers « Effacer la conversation », after the same confirming Dialog as « Effacer »,
 * and, when a higher offered Plan allows more (#732), names it as an Upgrade Prompt does, linking to its card on Mon
 * abonnement. « Voir le détail » opens the breakdown card. Nothing on a page without a conversation.
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
    maxMessages: bar.maxMessages ?? t("contextBar.unlimited"),
    tokens: formatTokens(bar.tokens, language),
    maxTokens: bar.maxTokens === null ? t("contextBar.unlimited") : formatTokens(bar.maxTokens, language),
  });
  const upgrade = bar.nearlyFull ? page.context?.upgrade : null;
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
      {upgrade ? (
        <p className="context-bar-upgrade">
          {t("contextBar.upgrade", { plan: upgrade.name[language] })}{" "}
          <a className={buttonClass({ variant: "quiet", size: "sm" })} href={`${routes.subscription}#plan-${upgrade.plan}-title`}>
            {t("contextBar.upgradeAction", { plan: upgrade.name[language] })}
          </a>
        </p>
      ) : null}
      <ContextBreakdown context={page.context} language={language} />
    </div>
  );
}

const CATEGORY_LABELS = {
  messages: "contextBar.breakdown.categories.messages",
  instructions: "contextBar.breakdown.categories.instructions",
  profile: "contextBar.breakdown.categories.profile",
  advice: "contextBar.breakdown.categories.advice",
  sources: "contextBar.breakdown.categories.sources",
  free: "contextBar.breakdown.categories.free",
} as const;

/**
 * The breakdown card (ADR-0078, #732), in the manner of an agent harness's context view: « Voir le détail » opens a Drawer
 * (full screen on a phone, ADR-0070) with the latest reply's context by category and the room left, as a stacked bar and a
 * list in jetons and %, out of the Plan's ceiling. Estimated, as the server kept it with that reply; empty before the first
 * reply and after « Effacer ».
 */
function ContextBreakdown({ context, language }: { context: ConversationContext | null; language: "fr" | "en" }) {
  const { t } = useTranslation();
  const breakdown = contextBreakdown(context);
  const percent = (share: number) => Math.round(share * 100);
  return (
    <Drawer
      trigger={
        <button className={`${buttonClass({ variant: "quiet", size: "sm" })} context-bar-details`} type="button">
          {t("contextBar.details")}
        </button>
      }
      title={t("contextBar.breakdown.title")}
    >
      {breakdown ? (
        <div className="context-breakdown">
          <p>{t(breakdown.maxTokens === null ? "contextBar.breakdown.introUnlimited" : "contextBar.breakdown.intro")}</p>
          <p className="context-breakdown-total">
            {t("contextBar.breakdown.total", {
              tokens: formatTokens(breakdown.tokens, language),
              maxTokens: breakdown.maxTokens === null ? t("contextBar.unlimited") : formatTokens(breakdown.total, language),
            })}
          </p>
          <div className="context-breakdown-bar" aria-hidden="true">
            {breakdown.lines.map((line) =>
              line.tokens > 0 ? <span key={line.category} data-category={line.category} style={{ width: `${line.share * 100}%` }} /> : null,
            )}
          </div>
          <ul className="context-breakdown-list">
            {breakdown.lines.map((line) => (
              <li key={line.category} data-category={line.category}>
                <span className="context-breakdown-swatch" aria-hidden="true" />
                <span className="context-breakdown-label">{t(CATEGORY_LABELS[line.category])}</span>
                <span className="context-breakdown-value">{t("contextBar.breakdown.value", { tokens: formatTokens(line.tokens, language), percent: percent(line.share) })}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p>{t("contextBar.breakdown.empty")}</p>
      )}
    </Drawer>
  );
}
