"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { routes } from "@/routes";
import { signalementDay } from "@/signalements/day";
import type { SignalementNotification } from "@/signalements";

/**
 * Tells the Candidate, atop every page of the signed-in workspace, that the Jobbbox team replied to one of their
 * Signalements or marked it « traité » (#377), in the Job Search Notification pattern: « L'équipe Jobbbox a répondu à
 * votre signalement du 25 octobre » or « Votre signalement du 25 octobre est traité », « Voir » leading to « Mes
 * signalements ». Each stays until closed or until that Section is opened, and is not shown there.
 *
 * Asked again on each page change, never polled. One polite live region, present from the start, so a screen reader
 * announces one that comes. No badge anywhere else.
 */
export function SignalementNotifications({ initial }: { initial: SignalementNotification[] }) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const [notifications, setNotifications] = useState(initial);
  // The page's data was fetched again (a refresh, a server action): start from it.
  const [rendered, setRendered] = useState(initial);
  if (initial !== rendered) {
    setRendered(initial);
    setNotifications(initial);
  }
  const region = useRef<HTMLDivElement>(null);
  const shownPath = useRef(pathname);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/signalements/notifications", { cache: "no-store" }).catch(() => null);
    if (!response?.ok) return;
    const next: { notifications?: SignalementNotification[] } | null = await response.json().catch(() => null);
    if (next?.notifications) setNotifications(next.notifications);
  }, []);

  useEffect(() => {
    const left = shownPath.current;
    if (left === pathname) return;
    shownPath.current = pathname;
    // « Mes signalements », just left, closed them all: don't show them again meanwhile.
    if (left === routes.accountSignalements) setNotifications([]);
    void refresh();
  }, [pathname, refresh]);

  function dismiss(signalementId: string) {
    setNotifications((current) => current.filter((notification) => notification.signalementId !== signalementId));
    void fetch(`/api/signalements/${encodeURIComponent(signalementId)}/notification`, { method: "DELETE" }).catch(() => undefined);
    // Its button is gone: keep the keyboard in the notifications, on the next one's.
    requestAnimationFrame(() => region.current?.querySelector<HTMLButtonElement>("button")?.focus());
  }

  const shown = pathname === routes.accountSignalements ? [] : notifications;
  return (
    // aria-live without role="status": a page's own status message stays the one status on it.
    <div ref={region} className="signalement-notifications" aria-live="polite">
      {shown.length > 0 ? (
        <ul aria-label={t("signalementNotifications.label")}>
          {shown.map((notification) => (
            <Notification key={notification.signalementId} notification={notification} onDismiss={() => dismiss(notification.signalementId)} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Notification({ notification, onDismiss }: { notification: SignalementNotification; onDismiss: () => void }) {
  const { t, i18n } = useTranslation();
  const messageId = `signalement-notification-${notification.signalementId}`;
  const date = signalementDay(new Date(notification.sentAt), new Date(), i18n.language);
  return (
    <li className="notice signalement-notification">
      <p id={messageId}>{t(notification.replied ? "signalementNotifications.replied" : "signalementNotifications.handled", { date })}</p>
      <div className="actions">
        <Link className="button button-primary" href={routes.accountSignalements} aria-describedby={messageId}>
          {t("signalementNotifications.see")}
        </Link>
        <button className="button" type="button" onClick={onDismiss} aria-describedby={messageId}>
          {t("signalementNotifications.dismiss")}
        </button>
      </div>
    </li>
  );
}
