"use client";

import { usePathname } from "next/navigation";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { formatTokens } from "@jobhub/shared";
import { contextBar, contextBreakdown, type ConversationContext, type ReplyCost } from "@/coach/conversation";
import { ClearConversationButton, useConversationFirst } from "@/components/conversation-first";
import { buttonClass } from "@/design/button-class";
import { Drawer } from "@/design/Drawer";
import { routes } from "@/routes";

/**
 * The Context bar (#607, ADR-0070), at the head of the side panel's « Activité » view, drawn as an agent harness's context
 * view (#980): how much of the page's Coach Conversation the AI Coach reads, « 18 % utilisé » with its messages out of those
 * it reads and the jetons of its context out of the ceiling, the Coach context limits of the Candidate's Plan (ADR-0078;
 * « illimité » when unlimited), as the server last said them (the estimate the context was sent with); then the stacked
 * bar of its categories and their legend, each with its jetons and its share (contextBreakdown), or one fill for a reply
 * saved before the split was kept (#731). Empty before the AI Coach's first reply, « Le coach n'a pas encore répondu »
 * (#810), so on `/profils/nouveau` too, while a Profile is created without a conversation. From 80 %, it says the AI Coach
 * reads only the latest messages and, when a higher offered Plan allows more (#732), names it as an Upgrade Prompt does,
 * linking to its card on Mon abonnement. At its foot « Voir le détail » opens the breakdown card, and « Effacer la
 * conversation » (#980, the Top Bar's « Effacer » until then) clears it after a confirming Dialog. Nothing on another page
 * without a conversation.
 */
export function ContextBar() {
  const { t, i18n } = useTranslation();
  const page = useConversationFirst()?.page;
  const pathname = usePathname();
  const titleId = useId();
  if (!page && pathname !== routes.newProfile) return null;
  const context = page?.context ?? null;
  const language = i18n.language === "en" ? "en" : "fr";
  const bar = contextBar(context);
  const percent = Math.round(bar.share * 100);
  const figures =
    context === null
      ? t("contextBar.noReply")
      : t("contextBar.figures", {
          messages: bar.messages,
          maxMessages: bar.maxMessages ?? t("contextBar.unlimited"),
          tokens: formatTokens(bar.tokens, language),
          maxTokens: bar.maxTokens === null ? t("contextBar.unlimited") : formatTokens(bar.maxTokens, language),
        });
  const upgrade = bar.nearlyFull ? context?.upgrade : null;
  const breakdown = contextBreakdown(context);
  const share = (value: number) => Math.round(value * 1000) / 10;
  return (
    <section className="context-bar panel-section" aria-labelledby={titleId} data-nearly-full={bar.nearlyFull || undefined}>
      <h3 id={titleId} className="panel-section-title context-bar-title">
        {t("contextBar.title")}
      </h3>
      {context === null ? (
        <p className="context-bar-figures">{figures}</p>
      ) : (
        <>
          <p className="context-bar-usage">
            <span className="context-bar-used">{t("contextBar.used", { percent })}</span>
            <span className="context-bar-figures">{figures}</span>
          </p>
          <div className="context-bar-track" role="meter" aria-labelledby={titleId} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={figures}>
            {breakdown ? (
              breakdown.lines.map((line) =>
                line.category !== "free" && line.tokens > 0 ? <span key={line.category} data-category={line.category} style={{ width: `${line.share * 100}%` }} /> : null,
              )
            ) : (
              <span style={{ width: `${percent}%` }} />
            )}
          </div>
          {breakdown ? (
            <ul className="context-legend">
              {breakdown.lines.map((line) => (
                <li key={line.category} data-category={line.category}>
                  <span className="context-breakdown-swatch" aria-hidden="true" />
                  <span className="context-legend-label">{t(CATEGORY_LABELS[line.category])}</span>
                  <span className="context-legend-value">{formatTokens(line.tokens, language)}</span>
                  <span className="context-legend-value">{t("contextBar.share", { percent: share(line.share).toLocaleString(language) })}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
      {bar.nearlyFull ? <p className="context-bar-warning">{t("contextBar.nearlyFull")}</p> : null}
      {upgrade ? (
        <p className="context-bar-upgrade">
          {t("contextBar.upgrade", { plan: upgrade.name[language] })}{" "}
          <a className={buttonClass({ variant: "quiet", size: "sm" })} href={`${routes.subscription}#plan-${upgrade.plan}-title`}>
            {t("contextBar.upgradeAction", { plan: upgrade.name[language] })}
          </a>
        </p>
      ) : null}
      <p className="context-bar-links">
        <ContextBreakdown context={context} language={language} />
        <ClearConversationButton />
      </p>
    </section>
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
          {context?.reply ? <ReplyCostLine reply={context.reply} language={language} /> : null}
        </div>
      ) : (
        <p>{t("contextBar.breakdown.empty")}</p>
      )}
    </Drawer>
  );
}

/**
 * « Cette réponse » (#790): what the latest reply sent in all, every one of its AI calls summed as the provider counted them,
 * with its Tool rounds and why it can exceed the context above (each call reads the whole context again). Tokens only, never
 * euros; a technical measure, not the Context bar's figure and nothing counted against a Plan.
 */
function ReplyCostLine({ reply, language }: { reply: ReplyCost; language: "fr" | "en" }) {
  const { t } = useTranslation();
  return (
    <section className="context-breakdown-reply" aria-labelledby="context-breakdown-reply-title">
      <h3 id="context-breakdown-reply-title" className="context-breakdown-reply-title">
        {t("contextBar.breakdown.reply.title")}
      </h3>
      <p className="context-breakdown-total">{t("contextBar.breakdown.reply.total", { count: reply.calls, tokens: formatTokens(reply.inputTokens, language) })}</p>
      <p>{reply.rounds > 0 ? t("contextBar.breakdown.reply.rounds", { count: reply.rounds }) : t("contextBar.breakdown.reply.noRounds")}</p>
      {reply.cachedInputTokens > 0 ? <p>{t("contextBar.breakdown.reply.cached", { tokens: formatTokens(reply.cachedInputTokens, language) })}</p> : null}
      <p className="context-breakdown-reply-why">{t("contextBar.breakdown.reply.why")}</p>
    </section>
  );
}
