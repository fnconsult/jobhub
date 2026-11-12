"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formatTokens } from "@jobhub/shared";
import { activityEntries, type ActivityEntry, type ReplyGiven, type ServedEntry } from "@/ai-activity/entries";
import { glyphNow } from "@/ai-activity/en-ce-moment";
import { entryToOpen, pageSummary, type QuotaUse } from "@/ai-activity/history";
import { liveView, type LiveAction, type LiveView } from "@/ai-activity/live";
import type { UsageMeter } from "@/billing/usage-meter";
import { ActivityGlyph } from "@/components/ActivityGlyph";
import { ActivityHistory } from "@/components/ActivityHistory";
import { useActivityColumn } from "@/components/activity-column";
import { useAiActivityLive } from "@/components/AiActivityLive";
import { useConversationFirst } from "@/components/conversation-first";
import { Icons } from "@/components/icons";
import { routes } from "@/routes";
import { creationOnPage } from "@/ai-activity/creation";
import { followedOn, followedSearchEntry } from "@/ai-activity/followed-search";

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
 * of a Profile being created, « Création du profil » (#810), and the Job Search the page follows as its own (#1001), « ici »
 * while it runs and an entry of its own once over. `usage`: the Usage Meter's
 * week, for the Plan Quotas the entries used. Candidate pages only: the Back Office mounts no provider.
 */
export function AiActivityProvider({ served = NO_ENTRIES, usage = null, children }: { served?: readonly ServedEntry[]; usage?: UsageMeter | null; children: ReactNode }) {
  const replies = useConversationFirst()?.page?.replies ?? NO_REPLIES;
  const store = useAiActivityLive();
  const pathname = usePathname();
  const column = useActivityColumn();
  const actions = store?.actions ?? NO_ACTIONS;
  // The Job Search this page follows as its own (the onboarding's offered one, #1001) is « ici » too.
  const followed = store?.followed ?? null;
  const live = useMemo(() => liveView(actions, pathname, followedOn(followed, pathname)), [actions, pathname, followed]);
  const stopAction = store?.stop;
  const stop = useCallback((key: string) => stopAction?.(key), [stopAction]);
  const [asked, setAsked] = useState<Control["asked"]>(null);
  const creation = creationOnPage(store?.creation ?? null, pathname);
  // Once over, the page that followed it keeps its entry, with its best Job Offers (#1001).
  const followedEntry = useMemo(() => (followedOn(followed, pathname) ? followedSearchEntry(followed, store?.followedAction ?? null) : null), [followed, pathname, store?.followedAction]);
  const entries = useMemo(
    () => activityEntries({ page: "any", built: served, replies, ...(creation ? { creation } : {}), ...(followedEntry ? { known: [followedEntry] } : {}) }),
    [served, replies, creation, followedEntry],
  );
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
 * AI Activity's icon, the first of the side panel's in the Top Bar (#809, #980, ADR-0086): it shows the panel on its
 * « Activité » view, and hides it again; so does Escape on it. The tasks icon, or while an action runs its live Activity
 * glyph (#333), with no words in its frame: its tooltip says « Activité IA ». While an action runs and Activity is not
 * shown, its step sits left of it with its stop icon (#369); clicking the step is clicking the icon. Its name says
 * « Activité IA », then the page's summary or the step under way (aria-labelledby), one tab stop. Renders nothing outside
 * AiActivityProvider or without a panel (the Back Office).
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
  const icon = underWay ? <UnderWayGlyph action={underWay} /> : <Icons.aiActivity />;
  return (
    <span className="ai-activity-control">
      <span id={labelId} hidden>
        {t("aiActivity.label")}
      </span>
      {words !== null ? (
        <span
          id={wordsId}
          className="ai-activity-summary"
          // The step under way shows; the page's summary is only said, in the icon's name.
          hidden={!underWay}
          onClick={() => {
            // The icon takes the focus, so it gets it back when Activity, opened over the conversation, closes.
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
        className="topbar-view topbar-activity"
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
      </button>
    </span>
  );
}

/**
 * The live glyph of the action under way, on « Activité » in the Top Bar (#333, ADR-0034): the very glyph « En ce moment »
 * draws (glyphNow), its step's label and the step itself included, so it morphs from one step into the next.
 */
export function UnderWayGlyph({ action }: { action: LiveAction }) {
  return <ActivityGlyph {...glyphNow(action)} live />;
}

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
 * The page's history in the side panel's « Activité » view (#980, ADR-0086), under « En ce moment »: the Activité entries by
 * day, then what the page adds (an object's latest Results, `children`) and « En savoir plus ». « Sources et outils de
 * cette page » is gone (#980): each entry names its own. Outside an AiActivityProvider, that the page has nothing yet.
 */
export function AiActivityContent({ children }: { children?: ReactNode }) {
  const control = useContext(AiActivityControl);
  // What the page adds stays outside AI Activity's own block: its links carry the object's address.
  return (
    <>
      <div className="fiche-activity">
        <ActivityHistory
          entries={control?.entries ?? []}
          inThread={control?.inThread ?? NO_MESSAGES}
          usage={control?.usage ?? null}
          asked={control?.asked ?? null}
        />
      </div>
      {children}
      <LearnMore />
    </>
  );
}

const NO_MESSAGES: ReadonlySet<string> = new Set();
