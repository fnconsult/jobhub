"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ProvenanceEvent } from "@jobhub/shared";
import { isRunning, nextLive, type LiveAction, type LiveEnded } from "@/ai-activity/live";
import type { RunningJobSearch } from "@/job-searches";

/** A Coach reply on its way, as the Coach Panel tells AI Activity about it. */
export interface CoachReplyLive {
  /** Each step's start and end, as POST /api/coach streams them. */
  event(event: ProvenanceEvent): void;
  /** Done, stopped, or failed with its Failure Reason's i18n key (null: not known). */
  end(outcome: "done" | "stopped" | "failed", reason?: string | null): void;
}

interface Live {
  /** The Candidate's AI actions running, or stopped or failed lately (ai-activity/live). */
  actions: readonly LiveAction[];
  /** A Coach reply starts, asked from `href`; `stop` aborts it. */
  coachReply(href: string, stop: () => void): CoachReplyLive;
  /** What the page's poll brought (JobSearchNotifications): the Job Searches searching, and those that stopped searching. */
  jobSearches(running: readonly RunningJobSearch[], ended: readonly LiveEnded[]): void;
  /** Stops an action: a Coach reply's request is aborted, a Job Search gets a Stop request. */
  stop(key: string): void;
  /** The Coach Panel opened or closed: open, it announces its replies itself. */
  coachPanel(open: boolean): void;
}

const LiveContext = createContext<Live | null>(null);
const JOB_SEARCH = "job_search:";

/**
 * Holds AI Activity's live actions (#333) above every page of a signed-in Candidate, so an action keeps showing, with its
 * step, on the page the Candidate moves to. Fed by the Coach Panel's stream and by the Job Search poll; only the Candidate's
 * own pages mount it, never the Back Office. It holds AI Activity's one live region too, so a page change neither loses nor
 * repeats what it says.
 */
export function AiActivityLiveProvider({ children }: { children: ReactNode }) {
  const [actions, dispatch] = useReducer(nextLive, []);
  const [coachPanelOpen, setCoachPanelOpen] = useState(false);
  const stops = useRef(new Map<string, () => void>());
  const replies = useRef(0);

  const api = useMemo(
    () => ({
      coachReply(href: string, stop: () => void): CoachReplyLive {
        const key = `coach_reply:${++replies.current}`;
        stops.current.set(key, stop);
        dispatch({ type: "started", key, kind: "coach_reply", href, at: new Date().toISOString() });
        return {
          event: (event) => dispatch({ type: "step", key, event }),
          end: (outcome, reason = null) => {
            stops.current.delete(key);
            dispatch({ type: "ended", key, outcome, at: new Date().toISOString(), reason });
          },
        };
      },
      jobSearches(running: readonly RunningJobSearch[], ended: readonly LiveEnded[]) {
        dispatch({ type: "job_searches", running, ended, at: new Date().toISOString() });
      },
      stop(key: string) {
        if (key.startsWith(JOB_SEARCH)) {
          const jobSearchId = key.slice(JOB_SEARCH.length);
          void fetch(`/api/job-searches/${encodeURIComponent(jobSearchId)}/stop`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
            .then((response) => {
              // 409: it ended meanwhile, and the poll says how.
              if (response.status === 202) dispatch({ type: "stopping", key });
            })
            .catch(() => undefined);
          return;
        }
        dispatch({ type: "stopping", key });
        stops.current.get(key)?.();
      },
      coachPanel: setCoachPanelOpen,
    }),
    [],
  );

  const live = useMemo<Live>(() => ({ actions, ...api }), [actions, api]);
  return (
    <LiveContext.Provider value={live}>
      {children}
      <LiveAnnouncer actions={actions} coachPanelOpen={coachPanelOpen} />
    </LiveContext.Provider>
  );
}

/**
 * One polite live region: the start of an action and its end, done, stopped or failed, never its steps (#333). A Coach
 * reply is left to the Coach Panel while it is open, which says both itself; a Job Search's end to its notification, but on
 * its own page, where the notification is not shown. An action found running later (a page loaded again) is not said to start.
 */
function LiveAnnouncer({ actions, coachPanelOpen }: { actions: readonly LiveAction[]; coachPanelOpen: boolean }) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const [seen, setSeen] = useState(actions);
  const [said, setSaid] = useState("");
  if (seen !== actions) {
    setSeen(actions);
    const told = (action: LiveAction) => (action.kind === "coach_reply" ? !coachPanelOpen : action.href === pathname);
    const before = new Map(seen.map((action) => [action.key, action]));
    const now = new Set(actions.map((action) => action.key));
    let message: string | null = null;
    for (const action of actions) {
      const was = before.get(action.key);
      if (!was && isRunning(action) && action.seenFromStart && (action.kind !== "coach_reply" || !coachPanelOpen)) {
        message = t(`aiActivity.live.announce.started.${action.kind}`);
      } else if (was && isRunning(was) && !isRunning(action) && told(action)) {
        message = t(`aiActivity.live.announce.${action.status === "stopped" ? "stopped" : "failed"}.${action.kind}`);
      }
    }
    for (const was of seen) if (!now.has(was.key) && isRunning(was) && told(was)) message = t(`aiActivity.live.announce.done.${was.kind}`);
    if (message !== null) setSaid(message);
  }
  return (
    <p className="visually-hidden ai-activity-announcer" aria-live="polite">
      {said}
    </p>
  );
}

/** AI Activity's live actions and what feeds them; null outside AiActivityLiveProvider (the Back Office, signed-out pages). */
export function useAiActivityLive(): Live | null {
  return useContext(LiveContext);
}
