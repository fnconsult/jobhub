"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formatTokens, type Activity } from "@jobhub/shared";
import { activityEntries, type ActivityEntry, type ReplyGiven, type ServedEntry } from "@/ai-activity/entries";
import { entryToOpen, type QuotaUse } from "@/ai-activity/history";
import { liveView, type LiveAction, type LiveView } from "@/ai-activity/live";
import type { UsageMeter } from "@/billing/usage-meter";
import { ActivityGlyph } from "@/components/ActivityGlyph";
import { ActivityHistory } from "@/components/ActivityHistory";
import { useActivityColumn } from "@/components/activity-column";
import { useAiActivityLive } from "@/components/AiActivityLive";
import { useConversationFirst } from "@/components/conversation-first";
import { Icons } from "@/components/icons";
import { routes } from "@/routes";

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
  open: boolean;
  paneId: string;
  toggle: () => void;
  close: () => void;
  button: React.RefObject<HTMLButtonElement | null>;
  /** The Candidate's AI actions running, or stopped or failed lately: this page's, and those « En cours ailleurs » (#333). */
  live: LiveView;
  /** Stops a running action. */
  stop: (key: string) => void;
};

const NO_ACTIONS: readonly LiveAction[] = [];
const NO_ENTRIES: readonly ServedEntry[] = [];
const NO_REPLIES: readonly ReplyGiven[] = [];

const AiActivityControl = createContext<Control | null>(null);

/**
 * AI Activity (CONTEXT.md, #314, #332, ADR-0086): the page's Activité entries, which the Fiche's « Activité » group and the
 * Activité column show under « En ce moment »: the server's (`served`, one loader per page type, ai-activity/index.ts),
 * finished with the AI Coach replies the page's thread shows, with their questions and cards (#808); and, live, the
 * Candidate's AI actions as they run, here or « En cours ailleurs » (AiActivityLive, #333). `usage`: the Usage Meter's
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
  const [open, setOpen] = useState(false);
  const [asked, setAsked] = useState<Control["asked"]>(null);
  const button = useRef<HTMLButtonElement>(null);
  const paneId = useId();
  const entries = useMemo(() => activityEntries({ page: "any", built: served, replies }), [served, replies]);
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
  const close = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => button.current?.focus());
  }, []);
  const control: Control = {
    entries,
    inThread,
    usage: quotas,
    asked,
    show,
    open,
    paneId: `${paneId}-pane`,
    toggle: () => (open ? close() : column ? column.open() : setOpen(true)),
    close,
    button,
    live,
    stop,
  };
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

/** « 3 modèles · 10,9k tokens »: the closed button's words, from the page's entries; null on a page where no model served. */
function useSummary(entries: readonly ActivityEntry[]): string | null {
  const { t } = useTranslation();
  const language = useLanguage();
  const models = new Set(entries.flatMap((entry) => entry.models.map((model) => model.name)));
  if (models.size === 0) return null;
  const tokens = entries.reduce<number | null>((sum, entry) => (entry.cost.tokens ? (sum ?? 0) + entry.cost.tokens.count : sum), null);
  return [t("aiActivity.models", { count: models.size }), tokens === null ? null : t("aiActivity.tokens", { tokens: formatTokens(tokens, language) })].filter((part) => part !== null).join(" · ");
}

/**
 * The button: in its frame, at rest the tasks icon, or while an action runs its live Activity glyph (#333); it opens
 * Activity (ADR-0086), the Fiche on its Activity group or the Activité column; open, a close icon. Closed, its words sit left of the frame, outside the button (#369): the page's summary, or the step under
 * way with its stop icon beside them, between the words and the frame; none on a page with no AI. The words are not a
 * control of their own: clicking them opens the pane, and the button's name says them (aria-labelledby), one tab stop.
 * Its label « Activité IA » is never shown, only its name for screen readers and its tooltip. On a phone, the frame
 * alone. Renders nothing outside AiActivityProvider.
 */
export function AiActivityButton() {
  const { t } = useTranslation();
  const control = useContext(AiActivityControl);
  const summary = useSummary(control?.entries ?? []);
  const labelId = useId();
  const wordsId = useId();
  if (!control) return null;
  const { open, paneId, toggle, close, button } = control;
  const underWay = open ? null : control.live.underWay;
  const words = open ? null : underWay ? <StepWords action={underWay} /> : summary;
  const icon = open ? <Icons.close /> : underWay ? <ActivityGlyph activity={underWay.current?.activity ?? BEFORE_FIRST_STEP} live /> : <Icons.aiActivity />;
  return (
    <span className="ai-activity-control">
      {words !== null ? (
        <span id={wordsId} className="ai-activity-summary" onClick={toggle}>
          {words}
        </span>
      ) : null}
      {underWay ? <StopButton action={underWay} stop={control.stop} /> : null}
      <button
        ref={button}
        className="ai-activity-toggle"
        type="button"
        aria-expanded={open}
        aria-controls={paneId}
        // Its name, with the words: « Activité IA 3 modèles · … ».
        aria-labelledby={words !== null ? `${labelId} ${wordsId}` : undefined}
        title={t("aiActivity.label")}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) close();
        }}
      >
        <span id={labelId} className="ai-activity-label">
          {t("aiActivity.label")}
        </span>
        <span className="ai-activity-frame">{icon}</span>
      </button>
    </span>
  );
}

/** The glyph before an action's first step. */
const BEFORE_FIRST_STEP: Activity = "think";

/** What an action under way is doing, in words: its step, « Arrêt en cours… », or « Démarrage » before its first step. */
function StepWords({ action }: { action: LiveAction }) {
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

/** Whether one of the Candidate's AI actions is under way on this page: « Activité » in the Top Bar shows it (#603). */
export function useAiActivityUnderWay(): boolean {
  return Boolean(useContext(AiActivityControl)?.live.underWay);
}
