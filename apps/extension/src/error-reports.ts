/**
 * The errors the extension reports to Jobbbox (#924), each an Extension Event of kind `error` the web app keeps
 * (POST /api/extension/events): a page it cannot capture (`captureImpossible`, « Cette page ne peut pas être
 * capturée… »), a call to the web app that failed (`callFailed`: 4xx, 5xx, or 0 for the network), an unexpected failure
 * in the Side Panel or the content script (`unexpected`). Each says where it happened and, for a page, its domain alone:
 * never its address, its text nor a stack trace, so the pages stay read in this browser (ADR-0002). The request carries
 * the Extension Version (API_VERSION_HEADERS) and the browser's session, so a signed-in Candidate's is theirs.
 *
 * Sent at best: never awaited, never retried, never thrown; a report that fails is not reported in turn.
 */
import { API_VERSION_HEADERS } from "./extension-update";

export const ERROR_REPORTS_PATH = "/api/extension/events";

/** Where in the extension: its Side Panel, the content script reading a page, or the badge it adds to a Job Site's page. */
export const ERROR_PLACES = ["side_panel", "content_script", "page_button"] as const;
export type ErrorPlace = (typeof ERROR_PLACES)[number];

export interface ErrorReport {
  errorCode: "captureImpossible" | "callFailed" | "unexpected";
  /** The message shown, by its key (`extension.captureImpossible`). */
  messageKey?: string;
  /** The web app's route that failed, its path alone. */
  route?: string;
  /** Its HTTP status; 0 when it was never answered. */
  httpStatus?: number;
  place: ErrorPlace;
  pageDomain?: string;
}

export interface ErrorReports {
  report(report: ErrorReport): void;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export function createErrorReports(webOrigin: string, fetchImpl: Fetch = (url, init) => fetch(url, init)): ErrorReports {
  return {
    report(report) {
      try {
        void fetchImpl(`${webOrigin}${ERROR_REPORTS_PATH}`, {
          method: "POST",
          headers: { ...API_VERSION_HEADERS, "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify(report),
        }).catch(() => {});
      } catch {
        // At best: nothing more to do.
      }
    },
  };
}

/** The domain of a page's address (`www.indeed.fr`), lower case, for a web page only; nothing else of it. */
export function pageDomainOf(address: string | null | undefined): string | undefined {
  if (!address) return undefined;
  try {
    const url = new URL(address);
    return url.protocol === "https:" || url.protocol === "http:" ? url.hostname.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

const CODES = new Set<string>(["captureImpossible", "callFailed", "unexpected"]);

/** A report a content script sent the background, as one (its other fields dropped), or null when it is none. */
export function readErrorReport(sent: unknown): ErrorReport | null {
  if (typeof sent !== "object" || sent === null) return null;
  const { errorCode, messageKey, route, httpStatus, place, pageDomain } = sent as Record<string, unknown>;
  if (typeof errorCode !== "string" || !CODES.has(errorCode) || !ERROR_PLACES.includes(place as ErrorPlace)) return null;
  return {
    errorCode: errorCode as ErrorReport["errorCode"],
    ...(typeof messageKey === "string" ? { messageKey } : {}),
    ...(typeof route === "string" ? { route } : {}),
    ...(typeof httpStatus === "number" ? { httpStatus } : {}),
    place: place as ErrorPlace,
    ...(typeof pageDomain === "string" ? { pageDomain } : {}),
  };
}
