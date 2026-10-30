"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { signInHref } from "@/auth/sign-in-return";
import { TOAST_DURATION_MS } from "@/design/Toast";
import "@/design/Toast.css";

/** What the page says of an answer from our API (#542): a session gone, or too many requests; null for the rest. */
export type ResponseNotice = { kind: "sessionExpired" } | { kind: "tooManyRequests"; seconds: number | null };

/** `Retry-After` in seconds: a number of seconds, or an HTTP date; null when absent or unreadable. */
export function retryAfterSeconds(header: string | null, now: number = Date.now()): number | null {
  if (!header) return null;
  if (/^\d+$/.test(header.trim())) return Number(header.trim());
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, Math.ceil((at - now) / 1000));
}

/** The notice for an answer of `status`: 401 only matters to someone signed in (their session expired). */
export function responseNotice(status: number, retryAfter: string | null, signedIn: boolean): ResponseNotice | null {
  if (status === 401 && signedIn) return { kind: "sessionExpired" };
  if (status === 429) return { kind: "tooManyRequests", seconds: retryAfterSeconds(retryAfter) };
  return null;
}

/** Whether `input` asks our own API, the one whose 401 and 429 the page explains. */
function asksOurApi(input: RequestInfo | URL): boolean {
  const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
  return url.origin === window.location.origin && url.pathname.startsWith("/api/");
}

/**
 * Watches the page's calls to our API (#542) and says, drawn as a Toast, what the person can do: their session expired
 * (a link to sign in again and come back here; nothing on the page is cleared, so what they typed can be copied first,
 * and it stays until they act), or they sent too many requests (when to try again, from `Retry-After`; it goes by
 * itself). An alert, put in the page only when there is something to say: no live region waits in every page.
 * `signedIn`: whether the page was drawn for a signed-in person.
 */
export function ResponseWatcher({ signedIn }: { signedIn: boolean }) {
  const { t } = useTranslation();
  const [shown, setShown] = useState<{ notice: ResponseNotice; back: string } | null>(null);

  useEffect(() => {
    const original = window.fetch;
    window.fetch = async (input, init) => {
      const response = await original(input, init);
      try {
        const notice = asksOurApi(input) ? responseNotice(response.status, response.headers.get("Retry-After"), signedIn) : null;
        if (notice) setShown({ notice, back: `${window.location.pathname}${window.location.search}` });
      } catch {
        // An address the page cannot read: nothing to say about it.
      }
      return response;
    };
    return () => {
      window.fetch = original;
    };
  }, [signedIn]);

  useEffect(() => {
    if (shown?.notice.kind !== "tooManyRequests") return;
    const timer = setTimeout(() => setShown(null), TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [shown]);

  if (!shown) return null;
  const { notice, back } = shown;
  return (
    <div className="ds-toast-region">
      <div role="alert" className="ds-toast">
        {notice.kind === "sessionExpired" ? (
          <>
            <span>{t("errorPage.toast.sessionExpired")}</span>
            <Link className="ds-toast__link" href={signInHref(back, true)}>
              {t("errorPage.toast.signInAgain")}
            </Link>
          </>
        ) : (
          <span>{notice.seconds ? t("errorPage.toast.tooManyRequests", { seconds: notice.seconds }) : t("errorPage.toast.tooManyRequestsSoon")}</span>
        )}
      </div>
    </div>
  );
}
