/**
 * Which frame of a tab a manual Capture takes. Some career sites show an empty
 * shell and put the posting in an iframe from their ATS (gestmax.fr, #187): the
 * Side Panel reads every frame it may read, and keeps the one holding the posting.
 */
import type { CapturedJobOffer, JobPage } from "./job-page";

/** What one frame of the tab reads (capture.js); frame 0 is the tab's own page. */
export interface FrameRead {
  frameId: number;
  page: JobPage | null;
}

type Candidate = { frameId: number; detected: boolean; jobOffer: CapturedJobOffer };

const isWebPage = (url: string | undefined) => /^https?:\/\//i.test(url ?? "");

/** Detected first, then the most text, then the tab's own page. */
const better = (a: Candidate, b: Candidate) =>
  Number(b.detected) - Number(a.detected) || b.jobOffer.content.length - a.jobOffer.content.length || Number(b.frameId === 0) - Number(a.frameId === 0);

/**
 * The Job Offer of the frame holding the posting: a frame where a posting is
 * detected, otherwise the one with the most text (the tab's own page on a tie);
 * null when no frame has one. A child frame that is not a web page of its own
 * (about:blank, srcdoc: ads, widgets) is never taken. The Job Offer keeps its
 * frame's URL.
 */
export function chooseFrame(frames: readonly FrameRead[]): CapturedJobOffer | null {
  const candidates = frames.flatMap(({ frameId, page }): Candidate[] =>
    page?.jobOffer && (frameId === 0 || isWebPage(page.jobOffer.source.url)) ? [{ frameId, detected: page.detected, jobOffer: page.jobOffer }] : [],
  );
  return candidates.sort(better)[0]?.jobOffer ?? null;
}
