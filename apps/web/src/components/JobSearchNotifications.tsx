"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatTimeOfDay } from "@jobhub/shared";
import { useAiActivityLive } from "@/components/AiActivityLive";
import type { JobSearchNotification, RunningJobSearch } from "@/job-searches";
import { routes } from "@/routes";

/** How often a page asks again while one of the Candidate's Job Searches is searching (ADR-0034). */
const JOB_SEARCH_POLL_MS = 1500;

export interface JobSearchNotificationsState {
  notifications: JobSearchNotification[];
  /** One of the Candidate's Job Searches is still searching: more may come. */
  searching: boolean;
  /** The Job Searches still searching, with their live steps so far (AI Activity's « En cours ailleurs », #330). */
  running: RunningJobSearch[];
}

/**
 * Tells the Candidate, atop every page of the signed-in workspace, that a Job
 * Search they started has finished: how many Job Offers it found; or when they
 * stopped it, or when it failed, at which step and why in plain words, with the
 * Job Offers it kept (#331). Each stays until they close it or open the Job Search.
 *
 * It checks again on every page change (a Job Search may just have started) and,
 * while one is searching, every 1.5 s, which also brings each running search's
 * steps so far (#330); it stops once none is searching (done, failed or stopped). One polite live region, present
 * from the start, so a screen reader announces each new notification. Left out
 * on the page of the Job Search it is about, which shows the outcome itself.
 * What each poll brings also feeds AI Activity's live actions (#333): each search searching, with its steps, on any page.
 */
export function JobSearchNotifications({ initial, everyMs = JOB_SEARCH_POLL_MS }: { initial: JobSearchNotificationsState; everyMs?: number }) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const [state, setState] = useState(initial);
  // The page's data was fetched again (a refresh, a server action): start from it.
  const [rendered, setRendered] = useState(initial);
  if (initial !== rendered) {
    setRendered(initial);
    setState(initial);
  }
  const region = useRef<HTMLDivElement>(null);
  const shownPath = useRef(pathname);
  const feedAiActivity = useAiActivityLive()?.jobSearches;

  useEffect(() => {
    feedAiActivity?.(state.running ?? [], state.notifications);
  }, [feedAiActivity, state]);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/job-searches/notifications", { cache: "no-store" }).catch(() => null);
    if (!response?.ok) return;
    const next: JobSearchNotificationsState | null = await response.json().catch(() => null);
    if (next) setState(next);
  }, []);

  useEffect(() => {
    const left = shownPath.current;
    if (left === pathname) return;
    shownPath.current = pathname;
    // The Job Search page just left dismissed its notification: don't show it again meanwhile.
    setState((current) => ({ ...current, notifications: current.notifications.filter((notification) => routes.jobSearch(notification.jobSearchId) !== left) }));
    void refresh();
  }, [pathname, refresh]);

  useEffect(() => {
    if (!state.searching) return;
    const timer = setInterval(() => void refresh(), everyMs);
    return () => clearInterval(timer);
  }, [state.searching, everyMs, refresh]);

  function dismiss(jobSearchId: string) {
    setState((current) => ({ ...current, notifications: current.notifications.filter((notification) => notification.jobSearchId !== jobSearchId) }));
    void fetch(`/api/job-searches/${encodeURIComponent(jobSearchId)}/notification`, { method: "DELETE" }).catch(() => undefined);
    // Its button is gone: keep the keyboard in the notifications, on the next one's.
    requestAnimationFrame(() => region.current?.querySelector<HTMLButtonElement>("button")?.focus());
  }

  const shown = state.notifications.filter((notification) => routes.jobSearch(notification.jobSearchId) !== pathname);
  return (
    // aria-live without role="status": a page's own status message stays the one status on it.
    <div ref={region} className="job-search-notifications" aria-live="polite">
      {shown.length > 0 ? (
        <ul aria-label={t("jobSearch.notifications.label")}>
          {shown.map((notification) => (
            <Notification key={notification.jobSearchId} notification={notification} onDismiss={() => dismiss(notification.jobSearchId)} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** The time of day it ended, in Paris time: « 10:42 », or with its date when it was another day. */
function useEndedAt(at: string): string {
  const { i18n } = useTranslation();
  return formatTimeOfDay(new Date(at), new Date(), i18n.language === "en" ? "en" : "fr", { timeZone: "Europe/Paris" });
}

function Notification({ notification, onDismiss }: { notification: JobSearchNotification; onDismiss: () => void }) {
  const { t } = useTranslation();
  const { jobSearchId, profile, outcome } = notification;
  const messageId = `job-search-notification-${jobSearchId}`;
  return (
    <li className={`notice job-search-notification job-search-notification-${outcome.status}`}>
      <div id={messageId}>
        {outcome.status === "done" ? <p>{t("jobSearch.notifications.done", { profile: profile.name, count: outcome.found })}</p> : null}
        {outcome.status === "stopped" ? <Stopped profile={profile.name} at={outcome.at} found={outcome.found} /> : null}
        {outcome.status === "failed" ? <Failed profile={profile.name} outcome={outcome} /> : null}
      </div>
      <div className="actions">
        <Link className="button button-primary" href={routes.jobSearch(jobSearchId)} aria-describedby={messageId}>
          {outcome.found > 0 ? t("jobSearch.notifications.seeResults") : t("jobSearch.notifications.seeSearch")}
        </Link>
        <button className="button" type="button" onClick={onDismiss} aria-describedby={messageId}>
          {t("jobSearch.notifications.dismiss")}
        </button>
      </div>
    </li>
  );
}

/** « Recherche arrêtée à 10:42 », with the Job Offers kept, or that it is not counted when it kept none. */
function Stopped({ profile, at, found }: { profile: string; at: string; found: number }) {
  const { t } = useTranslation();
  const time = useEndedAt(at);
  return (
    <>
      <p>{t("jobSearch.notifications.stopped", { profile, time, count: found })}</p>
      {found === 0 ? <p>{t("jobSearch.notCounted")}</p> : null}
    </>
  );
}

/** « Recherche échouée à 12:04 », at which step, why, and the Job Offers kept. */
function Failed({ profile, outcome }: { profile: string; outcome: Extract<JobSearchNotification["outcome"], { status: "failed" }> }) {
  const { t } = useTranslation();
  const time = useEndedAt(outcome.at);
  const kept = outcome.found > 0 ? ` ${t("jobSearch.keptBeforeFailure", { count: outcome.found })}` : "";
  return (
    <>
      <p>
        {outcome.step
          ? t("jobSearch.notifications.failedStep", { profile, time, step: t(`jobSearch.steps.${outcome.step}`) })
          : t("jobSearch.notifications.failed", { profile, time })}
      </p>
      <p>{`${t(`jobSearch.failureReasons.${outcome.failure}`)}${kept} ${t("jobSearch.notCounted")}`}</p>
    </>
  );
}
