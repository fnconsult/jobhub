"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
/** A server check remains authoritative; this also closes controls when an already-open page crosses its exact boundary. */
export function CancellationWindow({ at, children }: { at: string | null; children: ReactNode }) {
  const { t } = useTranslation(),
    [now, setNow] = useState(() => Date.now()),
    cutoff = at ? Date.parse(at) - 86400000 : null;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function update() {
      setNow(Date.now());
      if (cutoff !== null && cutoff >= Date.now()) timer = setTimeout(update, Math.min(2147483647, Math.max(1, cutoff - Date.now() + 1)));
    }
    update();
    document.addEventListener("visibilitychange", update);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, [cutoff]);
  return cutoff !== null && now > cutoff ? <p>{t("coachingCancellation.tooLate")}</p> : <>{children}</>;
}
