/**
 * Which frame of a tab a manual Capture takes. Some career sites show an empty
 * shell and put the posting in an iframe from their ATS (gestmax.fr, #187): the
 * Side Panel reads every frame it may read, and keeps the one holding the posting.
 */
import type { CapturedJobOffer, JobPage } from "./job-page";

/** What one frame of the tab reads (capture.js); frame 0 is the tab's own page. */
export interface FrameRead {
  frameId: number;
  /** `shown`: whether the frame is laid out on the page (see `pageShown`); a read without it counts as shown. */
  page: (JobPage & { shown?: boolean }) | null;
}

/**
 * Third parties' frames on a job page: captchas and bot checks, ad networks. On LinkedIn's search view, a reCAPTCHA
 * frame's page, hidden and never laid out, read as the text of its scripts, and was taken for the posting (2026-11-27).
 */
const THIRD_PARTY_FRAMES: readonly RegExp[] = [
  /^https:\/\/(www\.)?(google|recaptcha)\.[a-z.]+\/recaptcha\//,
  /^https:\/\/([a-z0-9-]+\.)*hcaptcha\.com\//,
  /^https:\/\/challenges\.cloudflare\.com\//,
  /^https:\/\/([a-z0-9-]+\.)*(doubleclick\.net|googlesyndication\.com|googleadservices\.com|amazon-adsystem\.com|adnxs\.com|criteo\.(com|net)|taboola\.com|outbrain\.com)\//,
];

const isThirdPartyFrame = (url: string | undefined) => THIRD_PARTY_FRAMES.some((pattern) => pattern.test(url ?? ""));

type Candidate = { frameId: number; detected: boolean; jobOffer: CapturedJobOffer };

const isWebPage = (url: string | undefined) => /^https?:\/\//i.test(url ?? "");

/** Detected first, then the most text, then the tab's own page. */
const better = (a: Candidate, b: Candidate) =>
  Number(b.detected) - Number(a.detected) || b.jobOffer.content.length - a.jobOffer.content.length || Number(b.frameId === 0) - Number(a.frameId === 0);

/**
 * The Job Offer of the frame holding the posting: a frame where a posting is
 * detected, otherwise the one with the most text (the tab's own page on a tie);
 * null when no frame has one. A child frame that is not a web page of its own
 * (about:blank, srcdoc: ads, widgets), that is not shown (display: none), or
 * that is a third party's (a captcha, an ad network: THIRD_PARTY_FRAMES) is
 * never taken. The Job Offer keeps its frame's URL.
 */
export function chooseFrame(frames: readonly FrameRead[]): CapturedJobOffer | null {
  return choosePage(frames)?.jobOffer ?? null;
}

/** The page of the frame `chooseFrame` takes: its Job Offer, and whether a posting is detected there (the Side Panel's posting in view). */
export function choosePage(frames: readonly FrameRead[]): { detected: boolean; jobOffer: CapturedJobOffer } | null {
  const candidates = frames.flatMap(({ frameId, page }): Candidate[] =>
    page?.jobOffer && !isThirdPartyFrame(page.jobOffer.source.url) && (frameId === 0 || (isWebPage(page.jobOffer.source.url) && page.shown !== false))
      ? [{ frameId, detected: page.detected, jobOffer: page.jobOffer }]
      : [],
  );
  const chosen = candidates.sort(better)[0];
  return chosen ? { detected: chosen.detected, jobOffer: chosen.jobOffer } : null;
}
