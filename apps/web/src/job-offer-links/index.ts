/**
 * Job Offer links: a Job Offer read from a link the Candidate pastes in the Coach Panel.
 *
 * One deep module. Callers get `findJobOfferLink(message)`, the first web link in a message, and
 * `createJobOfferLinks({ ai, jobOffers }).read(candidateId, url)`, which never throws:
 *  - a Forbidden site (FORBIDDEN_SITES) is never requested, nor a redirect to one: "forbidden_site",
 *    so the Candidate is sent to the browser extension, which captures what they are viewing;
 *  - a link to a Job Offer already stored gives it, without reading the page again;
 *  - otherwise the page is read the polite way Job discovery reads one (ADR-0002: robots.txt and the
 *    page's robots meta tag, as ourselves, never a private address, giving up at the first sign of bot
 *    protection or a sign-in): "unreadable" when it cannot be;
 *  - its JobPosting data, else what the AI reads from its text (the `offer_analysis` task, which
 *    carries no personal data and is recorded in AI Usage, the page's text passed as data it cannot
 *    close: ADR-0022), is captured as the Candidate's through `jobOffers.capture`, with the same
 *    validation and dedupe as the extension's; "not_a_job_offer" for a listing or any other page.
 * The Posting date the page states is trusted, as Job discovery's is; the Job Offer Summary and sector
 * are read only while `reading` (the "job-offer-reading" task Playbook) is served. The Job Offer's
 * analysis (its Match Score, At a glance) is left to its page, where the Candidate follows it.
 */
import { readJobPage, type AiLayer, type TaskInstructions } from "@jobhub/ai";
import { believablePostingDate, FORBIDDEN_SITES, isForbiddenSite, type JobOffer } from "@jobhub/shared";
import { countJobPostings, createPoliteFetcher, DEFAULT_USER_AGENT, htmlToText, metaRobots, readJobPosting, type Clock } from "@jobhub/shared/page-reading";
import type { JobOffers } from "../job-offers";

export type JobOfferLinkResult = { ok: true; jobOffer: JobOffer } | { ok: false; reason: "forbidden_site" | "unreadable" | "not_a_job_offer" };

export interface JobOfferLinks {
  /** The Job Offer at `url`, read for the Candidate (`candidateId`, for AI Usage), or why there is none. */
  read(candidateId: string, url: string): Promise<JobOfferLinkResult>;
}

export interface JobOfferLinksDeps {
  ai: AiLayer;
  jobOffers: Pick<JobOffers, "capture" | "findBySourceUrl">;
  /** The served "job-offer-reading" task Playbook, if any. Default: none (no summary, no sector). */
  reading?: () => Promise<TaskInstructions | null>;
  /** Default: the global fetch. */
  fetch?: typeof globalThis.fetch;
  /** Default: real time. */
  clock?: Clock;
}

/** As long as a Candidate waits for a reply: one page, read as Job discovery reads one. */
const TIMEOUT_MS = 15_000;
const MAX_BYTES = 3 * 1024 * 1024;

const LINK = /\bhttps?:\/\/[^\s<>"'«»]+/i;

/** The first http(s) link in the message, without the punctuation that ends its sentence, or null. */
export function findJobOfferLink(message: string): string | null {
  const found = LINK.exec(message)?.[0];
  if (!found) return null;
  const link = found.replace(/[.,;:!?)\]}]+$/, "");
  return hostOf(link) ? link : null;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
};

export function createJobOfferLinks(deps: JobOfferLinksDeps): JobOfferLinks {
  return {
    async read(candidateId, url) {
      const host = hostOf(url);
      if (host === null) return { ok: false, reason: "unreadable" };
      if (isForbiddenSite(host, FORBIDDEN_SITES)) return { ok: false, reason: "forbidden_site" };
      try {
        const stored = await deps.jobOffers.findBySourceUrl(url);
        if (stored) return { ok: true, jobOffer: stored };

        const fetcher = createPoliteFetcher({
          fetch: deps.fetch ?? globalThis.fetch,
          userAgent: DEFAULT_USER_AGENT,
          forbiddenSites: FORBIDDEN_SITES,
          timeoutMs: TIMEOUT_MS,
          maxBytes: MAX_BYTES,
          ...(deps.clock ? { clock: deps.clock } : {}),
        });
        // A redirect to a page already stored gives its Job Offer.
        const page = await fetcher.page(url, (target) => deps.jobOffers.findBySourceUrl(target));
        if (page.ok === "known") return { ok: true, jobOffer: page.known };
        if (!page.ok) return { ok: false, reason: page.reason === "site_terms" ? "forbidden_site" : "unreadable" };
        if (metaRobots(page.html).some((value) => /\b(noindex|none)\b/.test(value))) return { ok: false, reason: "unreadable" };

        let details = readJobPosting(page.html);
        if (!details && countJobPostings(page.html) <= 1) details = await readJobPage(deps.ai, candidateId, htmlToText(page.html), (await deps.reading?.()) ?? null);
        if (!details) return { ok: false, reason: "not_a_job_offer" };

        // What the server read from the page itself is trusted, as Job discovery's is: never a date from a browser.
        const { postedAt: stated, summary, sector, subsector, ...untrusted } = details;
        const postedAt = believablePostingDate(stated, new Date());
        const trusted = { ...(postedAt && { postedAt }), ...(summary && { summary }), ...(sector && { sector }), ...(subsector && { subsector }) };
        const captured = await deps.jobOffers.capture({ source: { url: page.url }, ...untrusted }, "candidate", trusted);
        return captured.ok ? { ok: true, jobOffer: captured.jobOffer } : { ok: false, reason: "not_a_job_offer" };
      } catch (error) {
        console.warn("[job-offer-links] a Job Offer link could not be read:", error instanceof Error ? error.name : "unknown");
        return { ok: false, reason: "unreadable" };
      }
    },
  };
}
