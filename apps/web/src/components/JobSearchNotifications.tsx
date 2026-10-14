"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { JobSearchNotification } from "@/job-searches";
import { routes } from "@/routes";

export interface JobSearchNotificationsState {
  notifications: JobSearchNotification[];
  /** One of the Candidate's Job Searches is still searching: more may come. */
  searching: boolean;
}

/**
 * Tells the Candidate, atop every page of the signed-in workspace, that a Job
 * Search they started has finished: how many Job Offers it found, or why it
 * failed in plain words. Each stays until they close it or open the Job Search.
 *
 * It checks again on every page change (a Job Search may just have started) and,
 * while one is searching, every few seconds. One polite live region, present
 * from the start, so a screen reader announces each new notification. Left out
 * on the page of the Job Search it is about, which shows the outcome itself.
 */
export function JobSearchNotifications({ initial, everyMs = 5000 }: { initial: JobSearchNotificationsState; everyMs?: number }) {
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

function Notification({ notification, onDismiss }: { notification: JobSearchNotification; onDismiss: () => void }) {
  const { t } = useTranslation();
  const { jobSearchId, profile, outcome } = notification;
  const messageId = `job-search-notification-${jobSearchId}`;
  return (
    <li className={`notice job-search-notification job-search-notification-${outcome.status}`}>
      <div id={messageId}>
        {outcome.status === "done" ? (
          <p>{t("jobSearch.notifications.done", { profile: profile.name, count: outcome.found })}</p>
        ) : (
          <>
            <p>{t("jobSearch.notifications.failed", { profile: profile.name })}</p>
            <p>{`${t(`jobSearch.failureReasons.${outcome.failure}`)} ${t("jobSearch.notCounted")}`}</p>
          </>
        )}
      </div>
      <div className="actions">
        <Link className="button button-primary" href={routes.jobSearch(jobSearchId)} aria-describedby={messageId}>
          {outcome.status === "done" && outcome.found > 0 ? t("jobSearch.notifications.seeResults") : t("jobSearch.notifications.seeSearch")}
        </Link>
        <button className="button" type="button" onClick={onDismiss} aria-describedby={messageId}>
          {t("jobSearch.notifications.dismiss")}
        </button>
      </div>
    </li>
  );
}
