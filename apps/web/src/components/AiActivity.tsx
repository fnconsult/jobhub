"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formatTokens, type Activity } from "@jobhub/shared";
import { activityEntries, type ActivityEntry, type ReplyGiven, type ServedEntry } from "@/ai-activity/entries";
import { entryToOpen, pageSummary, type QuotaUse } from "@/ai-activity/history";
import { liveView, type LiveAction, type LiveView } from "@/ai-activity/live";
import type { UsageMeter } from "@/billing/usage-meter";
import { ActivityGlyph } from "@/components/ActivityGlyph";
import { ActivityHistory } from "@/components/ActivityHistory";
import { useActivityColumn } from "@/components/activity-column";
import { useAiActivityLive } from "@/components/AiActivityLive";
import { useConversationFirst } from "@/components/conversation-first";
import { Icons } from "@/components/icons";
import { buttonClass } from "@/design/button-class";
import { routes } from "@/routes";
import { creationOnPage } from "@/ai-activity/creation";

type Language = "fr" | "en";

/** « Dans l'activité » under a reply, or one of its cards (its place under the reply). */
export type ActivityTarget = { messageId: string; card?: number };

type Control = {
  /** The page's Activité entries, newest first: the server's, with the replies its thread shows (ADR-0086, #808). */
  entries: ActivityEntry[];
  /** The replies the thread shows, by their message: « Voir dans la conversation » is offered for them only. */
  inThread: ReadonlySet<string>;
  /** The week's Plan Quotas as the Usage Meter reads them, for each entry's cost; null without a Usage Meter. */
  usage: readonly QuotaUse[] | null;
  /** The entry « Dans l'activité » last asked for, counted so asking again brings it back into view. */
  asked: { key: string; n: number } | null;
  /** Opens Activity on the entry of a reply or of one of its cards. */
  show: (target: ActivityTarget) => void;
  /** The Candidate's AI actions running, or stopped or failed lately: this page's, and those « En cours ailleurs » (#333). */
  live: LiveView;
  /** Stops a running action. */
  stop: (key: string) => void;
};

const NO_ACTIONS: readonly LiveAction[] = [];
const NO_ENTRIES: readonly ServedEntry[] = [];
const NO_REPLIES: readonly ReplyGiven[] = [];

export const AiActivityControl = createContext<Control | null>(null);

/**
 * AI Activity (CONTEXT.md, #314, #332, ADR-0086): the page's Activité entries, which the Fiche's « Activité » group and the
 * Activité column show under « En ce moment »: the server's (`served`, one loader per page type, ai-activity/index.ts),
 * finished with the AI Coach replies the page's thread shows, with their questions and cards (#808); and, live, the
 * Candidate's AI actions as they run, here or « En cours ailleurs » (AiActivityLive, #333); and what the browser alone knows
 * of a Profile being created, « Création du profil » (#810). `usage`: the Usage Meter's
 * week, for the Plan Quotas the entries used. Candidate pages only: the Back Office mounts no provider.
 */
export function AiActivityProvider({ served = NO_ENTRIES, usage = null, children }: { served?: readonly ServedEntry[]; usage?: UsageMeter | null; children: ReactNode }) {
  const replies = useConversationFirst()?.page?.replies ?? NO_REPLIES;
  const store = useAiActivityLive();
  const pathname = usePathname();
  const column = useActivityColumn();
  const actions = store?.actions ?? NO_ACTIONS;
  const live = useMemo(() => liveView(actions, pathname), [actions, pathname]);
  const stopAction = store?.stop;
  const stop = useCallback((key: string) => stopAction?.(key), [stopAction]);
  const [asked, setAsked] = useState<Control["asked"]>(null);
  const creation = creationOnPage(store?.creation ?? null, pathname);
  const entries = useMemo(() => activityEntries({ page: "any", built: served, replies, ...(creation ? { creation } : {}) }), [served, replies, creation]);
  const inThread = useMemo(() => new Set(replies.map((reply) => reply.messageId)), [replies]);
  const quotas = usage?.quotas ?? null;
  const openColumn = column?.open;
  const show = useCallback(
    (target: ActivityTarget) => {
      const key = entryToOpen(entries, target);
      if (!key) return;
      setAsked((was) => ({ key, n: (was?.n ?? 0) + 1 }));
      openColumn?.();
    },
    [entries, openColumn],
  );
  const control: Control = { entries, inThread, usage: quotas, asked, show, live, stop };
  return <AiActivityControl.Provider value={control}>{children}</AiActivityControl.Provider>;
}

/**
 * « Dans l'activité » under an AI Coach reply or one of its cards in the thread (#808): opens Activity on its entry. Null
 * outside an AiActivityProvider, or for a reply the page has no entry of.
 */
export function useShowInActivity(): ((target: ActivityTarget) => void) | null {
  return useContext(AiActivityControl)?.show ?? null;
}

function useLanguage(): Language {
  const { i18n } = useTranslation();
  return i18n.language === "en" ? "en" : "fr";
}

/** « 3 modèles · 10,9k tokens »: the button's words, from the page's entries; null on a page where no model served. */
export function useSummary(entries: readonly ActivityEntry[]): string | null {
  const { t } = useTranslation();
  const language = useLanguage();
  const summary = pageSummary(entries);
  if (!summary) return null;
  const { models, tokens } = summary;
  return [t("aiActivity.models", { count: models }), tokens === null ? null : t("aiActivity.tokens", { tokens: formatTokens(tokens, language) })].filter((part) => part !== null).join(" · ");
}

/**
 * AI Activity's button, « Activité » in the Top Bar (#809, ADR-0086): it shows Activity, the Fiche on its Activity group or
 * the Activité column, and hides it again; so does Escape on it. In its frame, the tasks icon, or while an action runs its
 * live Activity glyph (#333), and « Activité ». While Activity is not shown, its words sit left of the frame, outside the
 * button (#369): the page's summary, or the step under way with its stop icon beside them, between the words and the
 * frame; none on a page with no AI. The words are not a control of their own: clicking them is clicking the button, which
 * takes the focus, and its name says them (aria-labelledby): « Activité IA », then its words, one tab stop. On a phone,
 * the frame alone (app.css). Renders nothing outside AiActivityProvider or without a column (the Back Office).
 */
export function AiActivityButton() {
  const { t } = useTranslation();
  const control = useContext(AiActivityControl);
  const column = useActivityColumn();
  const summary = useSummary(control?.entries ?? []);
  const button = useRef<HTMLButtonElement>(null);
  const labelId = useId();
  const wordsId = useId();
  if (!control || !column) return null;
  const { shown, toggle, controls } = column;
  const underWay = control.live.underWay;
  // Shown, Activity says it all: « En ce moment » has the step and its stop icon.
  const words = shown ? null : underWay ? <StepWords action={underWay} /> : summary;
  const icon = underWay ? <ActivityGlyph activity={underWay.current?.activity ?? BEFORE_FIRST_STEP} live /> : <Icons.aiActivity />;
  return (
    <span className="ai-activity-control">
      <span id={labelId} hidden>
        {t("aiActivity.label")}
      </span>
      {words !== null ? (
        <span
          id={wordsId}
          className="ai-activity-summary"
          onClick={() => {
            // The button takes the focus, so it gets it back when Activity, opened over the conversation, closes.
            button.current?.focus();
            toggle();
          }}
        >
          {words}
        </span>
      ) : null}
      {underWay && !shown ? <StopButton action={underWay} stop={control.stop} /> : null}
      <button
        ref={button}
        className={`${buttonClass()} topbar-activity`}
        type="button"
        aria-expanded={shown}
        aria-controls={controls}
        // Its name, with the words: « Activité IA 3 modèles · … ».
        aria-labelledby={words !== null ? `${labelId} ${wordsId}` : labelId}
        title={t("aiActivity.label")}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === "Escape" && shown) toggle();
        }}
      >
        {icon}
        {t("fiche.activity")}
      </button>
    </span>
  );
}

/** The glyph before an action's first step. */
export const BEFORE_FIRST_STEP: Activity = "think";

/** What an action under way is doing, in words: its step, « Arrêt en cours… », or « Démarrage » before its first step. */
export function StepWords({ action }: { action: LiveAction }) {
  const { t } = useTranslation();
  if (action.status === "stopping") return t("aiActivity.live.stopping");
  return action.current ? t(`aiActivity.steps.${action.current.label}`) : t("aiActivity.live.starting");
}

/** The stop icon of a running action: icon only, named by its aria-label and its tooltip; disabled once the Stop is asked. */
export function StopButton({ action, stop }: { action: LiveAction; stop: (key: string) => void }) {
  const { t } = useTranslation();
  const name = t(`aiActivity.live.stop.${action.kind}`);
  return (
    <button className="button ai-activity-stop" type="button" aria-label={name} title={name} disabled={action.status === "stopping"} onClick={() => stop(action.key)}>
      <Icons.stop />
    </button>
  );
}

/** « En savoir plus » (#338, #320 § 12): « IA dans Jobbbox », the privacy policy's section, which names no provider. */
function LearnMore() {
  const { t } = useTranslation();
  return (
    <p className="ai-activity-learn-more">
      <Link href={routes.aiInJobbbox} aria-label={t("aiActivity.learnMoreLabel")}>
        {t("aiActivity.learnMore")}
      </Link>
    </p>
  );
}

/**
 * The page's history where the Fiche shows it, in its Activity group (#603, ADR-0070), or the Activité column, under
 * « En ce moment » (ADR-0086, #808): the Activité entries by day, then « Sources et outils de cette page » and « En savoir
 * plus ». Outside an AiActivityProvider, that the page has nothing yet.
 */
export function AiActivityContent() {
  const control = useContext(AiActivityControl);
  return (
    <div className="fiche-activity">
      <ActivityHistory
        entries={control?.entries ?? []}
        inThread={control?.inThread ?? NO_MESSAGES}
        usage={control?.usage ?? null}
        asked={control?.asked ?? null}
      />
      <LearnMore />
    </div>
  );
}

const NO_MESSAGES: ReadonlySet<string> = new Set();
