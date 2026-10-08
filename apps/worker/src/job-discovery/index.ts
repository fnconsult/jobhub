/**
 * Job discovery: the AI Coach's search for Job Offers matching a Profile's Search Criteria.
 *
 *   const discovery = createJobDiscovery({ ai, jobOffers });
 *   const report = await discovery.discover({ candidateId, criteria });
 *
 * One run: one web search through the AI layer (the query is built from the
 * Search Criteria alone, ADR-0007), then each result page is read politely
 * (robots.txt, site terms, no bot-protection workaround, ADR-0002). A page's
 * `JobPosting` structured data is used first; without it, the LLM reads the
 * page. Each posting is captured as a Job Offer; one already stored (same
 * source URL, or same text from another site) is returned, never duplicated,
 * and a known URL is not fetched again.
 */
import type { AiLayer } from "@jobhub/ai";
import type { JobOffer, JobOfferDetails, SearchCriteria } from "@jobhub/shared";
import { htmlToText, metaRobots } from "./html";
import { countJobPostings, readJobPosting } from "./job-posting";
import { extractWithLlm } from "./llm-extraction";
import { createPoliteFetcher, type Clock, type RefusalReason } from "./polite-fetch";

export type { RefusalReason } from "./polite-fetch";

/** Where Job Offers are stored. Satisfied by the web app's Job Offers module. */
export interface JobOfferStore {
  /** The Job Offer already captured from this source URL (ignoring tracking parameters), or null. */
  findBySourceUrl(url: string): Promise<JobOffer | null>;
  /** Stores a posting, or returns the stored Job Offer for the same posting. */
  capture(input: { source: { url: string }; } & JobOfferDetails): Promise<{ ok: true; jobOffer: JobOffer } | { ok: false; errors: unknown[] }>;
}

export interface JobDiscoveryOptions {
  ai: AiLayer;
  jobOffers: JobOfferStore;
  /** Default: the global fetch. */
  fetch?: typeof globalThis.fetch;
  /** How the crawler introduces itself to sites (and the name robots.txt rules address). */
  userAgent?: string;
  /** Hosts whose terms of use forbid crawling. Default: FORBIDDEN_SITES. */
  forbiddenSites?: readonly string[];
  /** Result pages read per run. Default 10. */
  maxPages?: number;
  /** For waiting out robots.txt Crawl-delay. Default: real time. */
  clock?: Clock;
}

export interface DiscoverRequest {
  /** The Candidate the search runs for (for AI usage and Plan Quotas). */
  candidateId: string;
  criteria: SearchCriteria;
}

/** Why a result page gave no Job Offer. */
export type SkipReason = RefusalReason | "not_a_job_offer" | "invalid";

export interface DiscoveryReport {
  /** The Job Offers found, new or already stored, each once. */
  jobOffers: JobOffer[];
  /** Result pages that gave no Job Offer, and why. */
  skipped: { url: string; reason: SkipReason }[];
}

export interface JobDiscovery {
  discover(request: DiscoverRequest): Promise<DiscoveryReport>;
}

export const DEFAULT_USER_AGENT = "JobbboxBot/1.0 (+https://jobbbox.fr/robot)";

/**
 * Sites whose terms of use forbid automated access (ADR-0002). They are covered
 * only by the browser extension, which captures what the Candidate is viewing.
 */
export const FORBIDDEN_SITES = ["linkedin.com", "indeed.com", "indeed.fr", "glassdoor.com", "glassdoor.fr"] as const;

export function createJobDiscovery(options: JobDiscoveryOptions): JobDiscovery {
  const maxPages = options.maxPages ?? 10;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;

  return {
    async discover({ candidateId, criteria }) {
      const fetcher = createPoliteFetcher({
        fetch: options.fetch ?? globalThis.fetch,
        userAgent,
        forbiddenSites: options.forbiddenSites ?? FORBIDDEN_SITES,
        timeoutMs: 15_000,
        maxBytes: 3 * 1024 * 1024,
        clock: options.clock,
      });
      const search = await options.ai.searchWeb({ candidateId, criteria });
      const sources = [...new Set(search.sources)].slice(0, maxPages);

      const found = new Map<string, JobOffer>();
      const skipped: DiscoveryReport["skipped"] = [];
      const storedAt = (url: string) => options.jobOffers.findBySourceUrl(url).catch(() => null);
      for (const url of sources) {
        const known = await storedAt(url);
        if (known) {
          found.set(known.id, known);
          continue;
        }
        // A result can redirect to a page captured earlier (in this run or before): use that Job Offer.
        const page = await fetcher.page(url, storedAt);
        if (page.ok === "known") {
          found.set(page.known.id, page.known);
          continue;
        }
        if (!page.ok) {
          skipped.push({ url, reason: page.reason });
          continue;
        }
        if (metaRobots(page.html).some((value) => /\b(noindex|none)\b/.test(value))) {
          skipped.push({ url, reason: "robots" });
          continue;
        }
        const details =
          readJobPosting(page.html) ??
          (countJobPostings(page.html) > 1 ? null : await extractWithLlm(options.ai, candidateId, htmlToText(page.html)));
        if (!details) {
          skipped.push({ url, reason: "not_a_job_offer" });
          continue;
        }
        const captured = await options.jobOffers.capture({ source: { url: page.url }, ...details });
        if (captured.ok) found.set(captured.jobOffer.id, captured.jobOffer);
        else skipped.push({ url, reason: "invalid" });
      }
      return { jobOffers: [...found.values()], skipped };
    },
  };
}
