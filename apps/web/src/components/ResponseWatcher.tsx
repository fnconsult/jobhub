"use client";

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { signInHref } from "@/auth/sign-in-return";
import { useToast } from "@/design/Toast";

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
 * Watches the page's calls to our API (#542) and says, in a Toast, what the person can do: their session expired (a
 * link to sign in again and come back here; nothing on the page is cleared, so what they typed can be copied first), or
 * they sent too many requests (when to try again, from `Retry-After`). `signedIn`: whether the page was drawn for a
 * signed-in person.
 */
export function ResponseWatcher({ signedIn }: { signedIn: boolean }) {
  const { t } = useTranslation();
  const toast = useToast();
  useEffect(() => {
    const original = window.fetch;
    window.fetch = async (input, init) => {
      const response = await original(input, init);
      try {
        const notice = asksOurApi(input) ? responseNotice(response.status, response.headers.get("Retry-After"), signedIn) : null;
        if (notice?.kind === "sessionExpired") {
          const here = `${window.location.pathname}${window.location.search}`;
          toast({ message: t("errorPage.toast.sessionExpired"), link: { label: t("errorPage.toast.signInAgain"), href: signInHref(here, true) } });
        } else if (notice?.kind === "tooManyRequests") {
          toast({ message: notice.seconds ? t("errorPage.toast.tooManyRequests", { seconds: notice.seconds }) : t("errorPage.toast.tooManyRequestsSoon") });
        }
      } catch {
        // An address the page cannot read: nothing to say about it.
      }
      return response;
    };
    return () => {
      window.fetch = original;
    };
  }, [signedIn, t, toast]);
  return null;
}
