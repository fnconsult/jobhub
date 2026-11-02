"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { buttonClass } from "@/design/button-class";
import { EXIT_DELAY_SECONDS, exitRedirectsBySelf } from "@/external-links";

type Phase = "waiting" | "counting" | "cancelled";

/**
 * The Exit Page's actions: « Continuer vers <site> », which goes there now, and the shell's home. Reached from a page
 * of Jobbbox, it counts down EXIT_DELAY_SECONDS seconds, then goes by itself, unless the person clicks « Annuler »;
 * reached from anywhere else, it waits for the click (see exitRedirectsBySelf). It replaces itself in the history, so
 * « Précédent » on the site comes back to the page the link was on, not here.
 */
export function ExitCountdown({ url, site, home }: { url: string; site: string; home: { href: string; label: string } }) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>("waiting");
  const [seconds, setSeconds] = useState(EXIT_DELAY_SECONDS);

  useEffect(() => {
    // The referrer is only known in the browser: the page is drawn waiting, then starts counting.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (exitRedirectsBySelf(document.referrer, window.location.origin)) setPhase("counting");
  }, []);

  useEffect(() => {
    if (phase !== "counting") return;
    if (seconds <= 0) {
      window.location.replace(url);
      return;
    }
    const tick = window.setTimeout(() => setSeconds((left) => left - 1), 1000);
    return () => window.clearTimeout(tick);
  }, [phase, seconds, url]);

  return (
    <>
      <p className="ds-error__countdown" role="status">
        {phase === "counting"
          ? t("errorPage.exit.countdown", { count: seconds, site })
          : phase === "cancelled"
            ? t("errorPage.exit.cancelled")
            : t("errorPage.exit.check")}
      </p>
      <div className="ds-error__actions">
        <a className={buttonClass({ variant: "primary" })} href={url} rel="noopener noreferrer nofollow" onClick={() => setPhase("cancelled")}>
          {t("errorPage.exit.continue", { site })}
        </a>
        {phase === "counting" ? (
          <button className={buttonClass()} type="button" onClick={() => setPhase("cancelled")}>
            {t("errorPage.exit.cancel")}
          </button>
        ) : null}
        <Link className={buttonClass({ variant: phase === "counting" ? "quiet" : "secondary" })} href={home.href}>
          {home.label}
        </Link>
      </div>
    </>
  );
}
