/**
 * Job discovery: the AI Coach's search for Job Offers matching a Profile's Search Criteria.
 *
 *   const discovery = createJobDiscovery({ ai, jobOffers });
 *   const report = await discovery.discover({ candidateId, criteria });
 *
 * One run: one web search through the AI layer (the query is built from the
 * Search Criteria alone, ADR-0007), then each result page is read politely
 * (robots.txt, site terms, no bot-protection workaround, ADR-0002). Result pages
 * are the provider's sources, then the URLs its answer text names: the answer
 * itself never makes a Job Offer. A listing page has up to 5 of its postings on
 * the same site followed and read the same way (see listing-page.ts). A page's
 * `JobPosting` structured data is used first; without it, the LLM reads the
 * page. Each posting is captured as a Job Offer; one already stored (same
 * source URL, or same text from another site) is returned, never duplicated,
 * and a known URL is not fetched again.
 *
 * A run reads result pages in order until its budget runs out: 30 Job Offers,
 * €0.08 or 90 s by default, whichever comes first (see JobDiscoveryBudget).
 *
 * Each run is measured (its funnel and cost in €), also when it fails: the
 * error is then a JobDiscoveryError carrying what the run measured until then.
 */
import { costInEur, type AiLayer } from "@jobhub/ai";
import type { DiscoveryMetrics, JobOffer, JobOfferDetails, SearchCriteria, SkipReason as CountedSkipReason } from "@jobhub/shared";
import { DEFAULT_BUDGET, type JobDiscoveryBudget } from "./budget";
import { htmlToText, metaRobots } from "./html";
import { countJobPostings, readJobPosting } from "./job-posting";
import { listingPageLinks } from "./listing-page";
import { extractWithLlm } from "./llm-extraction";
import { createPoliteFetcher, realClock, type Clock, type RefusalReason } from "./polite-fetch";

export { DEFAULT_BUDGET, jobDiscoveryBudgetFromEnv, type JobDiscoveryBudget } from "./budget";
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
  /** When a run stops reading result pages. Default: DEFAULT_BUDGET. */
  budget?: Partial<JobDiscoveryBudget>;
  /** For waiting out robots.txt Crawl-delay and timing the budget. Default: real time. */
  clock?: Clock;
}

export interface DiscoverRequest {
  /** The Candidate the search runs for (for AI usage and Plan Quotas). */
  candidateId: string;
  criteria: SearchCriteria;
}

/** Why a result page gave no Job Offer. */
export type SkipReason = RefusalReason | "not_a_job_offer" | "invalid";
// The Job discovery metrics count pages by these reasons: the two lists must stay the same.
const sameSkipReasons: [SkipReason, CountedSkipReason] extends [CountedSkipReason, SkipReason] ? true : never = true;
void sameSkipReasons;

export interface DiscoveryReport {
  /** The Job Offers found, new or already stored, each once. */
  jobOffers: JobOffer[];
  /** Result pages that gave no Job Offer, and why. */
  skipped: { url: string; reason: SkipReason }[];
  /** How many results went how far: the stages before deduplication (`jobOffers` is the one after). */
  funnel: DiscoveryFunnel;
  /** The estimated cost in € of the run's AI calls: the web search and each page the LLM read. */
  costEur: number;
}

/** The funnel's stages up to deduplication. Provider URLs are looked at in order until the budget runs out. */
export type DiscoveryFunnel = Omit<DiscoveryMetrics["funnel"], "afterDedup" | "matched">;

/** Job discovery failed part-way: `partial` is what the run found and measured until then. */
export class JobDiscoveryError extends Error {
  constructor(
    readonly partial: DiscoveryReport,
    readonly cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "JobDiscoveryError";
  }
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
  const budget = { ...DEFAULT_BUDGET, ...options.budget };
  const clock = options.clock ?? realClock;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;

  return {
    async discover({ candidateId, criteria }) {
      const startedAt = clock.now();
      const fetcher = createPoliteFetcher({
        fetch: options.fetch ?? globalThis.fetch,
        userAgent,
        forbiddenSites: options.forbiddenSites ?? FORBIDDEN_SITES,
        timeoutMs: 15_000,
        maxBytes: 3 * 1024 * 1024,
        clock,
      });
      const found = new Map<string, JobOffer>();
      const report: DiscoveryReport = {
        jobOffers: [],
        skipped: [],
        funnel: { providerUrls: 0, fetched: 0, extracted: 0, alreadyStored: 0 },
        costEur: 0,
      };
      const ai = costing(options.ai, (eur) => (report.costEur += eur));
      const { funnel, skipped } = report;
      const budgetSpent = () =>
        found.size >= budget.jobOffers || report.costEur >= budget.spendEur || clock.now() - startedAt >= budget.seconds * 1000;
      /** URLs looked at in this run, so a posting a listing page links to is not read twice. */
      const seen = new Set<string>();
      const storedAt = (url: string) => options.jobOffers.findBySourceUrl(url).catch(() => null);
      const alreadyStored = (jobOffer: JobOffer) => {
        found.set(jobOffer.id, jobOffer);
        funnel.alreadyStored++;
      };

      /** Reads one page, and when `follow` and it is a listing page, the postings it links to. */
      const read = async (url: string, follow: boolean): Promise<void> => {
        if (seen.has(url)) return;
        seen.add(url);
        const known = await storedAt(url);
        if (known) {
          alreadyStored(known);
          return;
        }
        // A result can redirect to a page captured earlier (in this run or before): use that Job Offer.
        const page = await fetcher.page(url, storedAt);
        if (page.ok === "known") {
          alreadyStored(page.known);
          return;
        }
        if (!page.ok) {
          skipped.push({ url, reason: page.reason });
          return;
        }
        funnel.fetched++;
        if (metaRobots(page.html).some((value) => /\b(noindex|none)\b/.test(value))) {
          skipped.push({ url, reason: "robots" });
          return;
        }
        let details = readJobPosting(page.html);
        if (!details) {
          const links = follow ? listingPageLinks(page) : [];
          if (links.length > 0) {
            skipped.push({ url, reason: "not_a_job_offer" });
            for (const link of links) {
              if (budgetSpent()) break;
              await read(link, false);
            }
            return;
          }
          if (countJobPostings(page.html) <= 1) details = await extractWithLlm(ai, candidateId, htmlToText(page.html));
        }
        if (!details) {
          skipped.push({ url, reason: "not_a_job_offer" });
          return;
        }
        funnel.extracted++;
        const captured = await options.jobOffers.capture({ source: { url: page.url }, ...details });
        if (captured.ok) found.set(captured.jobOffer.id, captured.jobOffer);
        else skipped.push({ url, reason: "invalid" });
      };

      try {
        const search = await ai.searchWeb({ candidateId, criteria });
        // The answer text only points at pages to read: a Job Offer always comes from a page read.
        const distinct = [...new Set([...search.sources, ...urlsIn(search.answer)])];
        funnel.providerUrls = distinct.length;
        for (const url of distinct) {
          if (budgetSpent()) break;
          await read(url, true);
        }
      } catch (error) {
        report.jobOffers = [...found.values()];
        throw new JobDiscoveryError(report, error);
      }
      report.jobOffers = [...found.values()];
      return report;
    },
  };
}

/** The web addresses written in a text, in order (a Markdown link's too), without the punctuation that follows them. */
function urlsIn(text: string): string[] {
  return (text.match(/https?:\/\/[^\s<>"'`()[\]{}«»]+/g) ?? []).map((url) => url.replace(/[.,;:!?]+$/, ""));
}

/** The AI layer, telling `spend` the cost in € of each call made through it. */
function costing(ai: AiLayer, spend: (eur: number) => void): AiLayer {
  return {
    async generate(request) {
      const result = await ai.generate(request);
      spend(costInEur(result));
      return result;
    },
    async searchWeb(request) {
      const result = await ai.searchWeb(request);
      spend(costInEur(result));
      return result;
    },
    async searchCompany(request) {
      const result = await ai.searchCompany(request);
      spend(costInEur(result));
      return result;
    },
  };
}
