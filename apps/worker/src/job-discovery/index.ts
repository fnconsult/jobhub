/**
 * Job discovery: the AI Coach's search for Job Offers matching a Profile's Search Criteria.
 *
 *   const discovery = createJobDiscovery({ ai, jobOffers });
 *   const report = await discovery.discover({ candidateId, criteria });
 *
 * One run: up to 6 web searches through the AI layer, one per query of the Job
 * Search's plan (the Search Criteria title and up to 2 variants, in French and
 * English; built from the Search Criteria alone, ADR-0007), as many to a call as the
 * Search provider takes (Perplexity: 5, ADR-0043), each steered away
 * from forbidden sites and toward postings of the last 30 days. A query's next
 * page of results is searched only while its last page gave at least one new
 * readable posting (see search-pages.ts). Each result page is read politely
 * (robots.txt, site terms, no bot-protection workaround, ADR-0002). Result pages
 * are the provider's sources, then the URLs its answer text names, each once per
 * run: the answer itself never makes a Job Offer. A listing page has up to 5 of its postings on
 * the same site followed and read the same way (see listing-page.ts). A
 * Greenhouse, Lever or Ashby posting is read through its ATS's public JSON API
 * instead of its page, politely too (see ats.ts): it then carries the posting
 * date the ATS states, and is dropped when closed or first published more
 * than 30 days ago; when its API cannot be read (too large, as a large
 * employer's whole Ashby board, down, or kept out by robots.txt), its page is
 * read instead, unless the API showed an anti-bot check. Each API answer is
 * kept for the run, so an employer's Ashby board is downloaded once. On a
 * page read, its `JobPosting` structured data is used first; without it, the
 * LLM reads the page. A posting's Posting date is the one its ATS or its
 * `JobPosting` (`datePosted`) states, else the search provider's date for the
 * page; a posting dated more than 30 days ago is dropped, an undated one kept
 * (the freshness rule, #116). Each posting is captured as a Job Offer; one already stored (same
 * source URL, or same text from another site) is returned, never duplicated,
 * and a known URL is not fetched again.
 *
 * When France Travail is configured (see france-travail/), a run first searches
 * its offers by structured filters (the ROME codes of the Search Criteria title,
 * the area, the contract type), for no more Job Offers than the budget has left;
 * each offer is captured like a posting read, at its France Travail page and
 * dated by its creation. France Travail refusing or failing never fails the run:
 * it is counted (`franceTravail` in the report) and the web search goes on.
 *
 * When Fantastic.jobs' key is set (see fantastic-jobs/), a run then searches its
 * ATS postings (`active-ats`: employers' own career pages) by the Search Criteria
 * title and location, the same way: for no more Job Offers than the budget has
 * left (each job it returns is charged), each captured at its ATS page and dated
 * by its posting, or found stored. Its refusal (key rejected, quota spent) or
 * failure never fails the run either: it is counted (`fantasticJobs` in the
 * report, with its estimated cost, kept apart from the AI calls') and the run
 * goes on with the other sources.
 *
 * Administrators set the Job discovery sources and sites in the Back Office (#188),
 * read at the start of each run (`settings`): a disabled source (France Travail,
 * Fantastic.jobs, the web search, the ATS APIs) is skipped; each enabled Job discovery site adds
 * one web search, the plan's first query restricted to that site, after the
 * plan's own queries; a result page on a disabled site is skipped
 * (`site_disabled`). When the settings cannot be read, every source is searched
 * and no site is listed, as before the Back Office managed them. Without the key of
 * its Search provider (#399), the web search is unavailable and skipped the same way:
 * the other sources still run.
 *
 * A run searches and reads result pages in order until its budget runs out: 30
 * Job Offers, €0.08 or 90 s by default, whichever comes first (see JobDiscoveryBudget).
 * France Travail's and Fantastic.jobs' offers count toward it like any other Job Offers, and their time too.
 *
 * Search Criteria with several locations (ADR-0025) get one search per location,
 * in their order (France Travail, Fantastic.jobs, then the web searches, for each), each query
 * naming every contract type and remote-work option wanted. The budget is shared
 * between the locations, never multiplied: of n locations, the k-th searches until
 * the run has used k/n of each limit (Job Offers, euros, seconds), so a location
 * using less than its share leaves the rest to the next one, and the last one may
 * use whatever remains. The job titles are planned once per run, and a page or
 * Job Offer found for one location is not read or counted again for another.
 *
 * The queries' wording and the job title step's instructions and AI are the "job-search-queries"
 * task Playbook's, read at the start of each run (ADR-0026); the LLM reading a page writes the Job
 * Offer Summary and sector only while the "job-offer-reading" task Playbook is served.
 *
 * The run's web searches go to the active Search provider until it fails (key missing, refused, rate limited, down):
 * then the rest of the run goes to its fallback, when its key is set, and the report says so (`searchFallback`).
 *
 * Each run is measured (its funnel and cost in €), also when it fails: the
 * error is then a JobDiscoveryError carrying what the run measured until then.
 *
 * Each Job Offer captured is handed its Provenance (`TrustedFacts.provenance`): how it was found (the web
 * search, or France Travail's or Fantastic.jobs' search), the listing page that led to it, its ATS API or page
 * read and the model that read the page (its summary's), on the site of its page. It names no Candidate.
 *
 * A run the Candidate stops (its request's `signal`, #331) starts no step after, its AI call on its way is stopped,
 * and it reports what it found until then, as a run whose budget is spent: it does not fail.
 *
 * The run itself is recorded too (#330): every step of it (the job title variants, each source, each web
 * search, page read and the model that read it), each told to the request's `onEvent` as it starts and ends,
 * and kept, folded, in the report's `run`, which the caller goes on recording into (its Match Scores) before
 * it stores the run's Provenance. A failed run's partial report has it too.
 */
import type { ExternalApiLog } from "@jobhub/shared";
import { costInEur, createProvenanceRecorder, createWebSearchRun, readJobPage, WebSearchUnavailable, type AiLayer, type SearchFallback, type JobSearchQuery, type ProvenanceRecorder, type SearchFilters, type StepTool } from "@jobhub/ai";
import { servedTaskRun, taskRun, type TaskPlaybookReader } from "@jobhub/web/task-playbooks";
import {
  believablePostingDate,
  DEFAULT_JOB_DISCOVERY_SETTINGS,
  FORBIDDEN_SITES,
  isForbiddenSite,
  isOnDomain,
  isPostingTooOld,
  joinProvenance,
  NO_INDUSTRY_REFERENCE,
  type DiscoveryMetrics,
  type DiscoverySearch,
  type DiscoveryStopReason,
  type IndustryReference,
  type JobDiscoverySettings,
  type FantasticJobsMetrics,
  type FranceTravailMetrics,
  type JobOffer,
  type JobOfferDetails,
  type Provenance,
  type ProvenanceEvent,
  type SearchCriteria,
  type SkipReason as CountedSkipReason,
} from "@jobhub/shared";
import { atsToolOf, readAtsPosting } from "./ats";
import { DEFAULT_BUDGET, type JobDiscoveryBudget } from "./budget";
import { DEFAULT_WEB_SEARCH_SETTINGS, type WebSearchSettings } from "./search-settings";
import type { FantasticJobs } from "./fantastic-jobs";
import type { FranceTravail } from "./france-travail";
import { listingPageLinks } from "./listing-page";
import { searchPages } from "./search-pages";
import {
  countJobPostings,
  createPoliteFetcher,
  DEFAULT_USER_AGENT,
  htmlToText,
  metaRobots,
  pageReadTool,
  readJobPosting,
  realClock,
  recordingSiteFetch,
  type Clock,
  type JsonResult,
  type RefusalReason,
} from "@jobhub/shared/page-reading";

export { MAX_POSTING_AGE_DAYS } from "@jobhub/shared";
export { DEFAULT_BUDGET, jobDiscoveryBudgetFromEnv, type JobDiscoveryBudget } from "./budget";
export { DEFAULT_WEB_SEARCH_SETTINGS, webSearchSettingsFromEnv, type WebSearchSettings } from "./search-settings";
export type { RefusalReason } from "@jobhub/shared/page-reading";
export { franceTravailFromEnv, type FranceTravail } from "./france-travail";
export { chargedCostEur, eurPerJobFromEnv, fantasticJobsFromEnv, type FantasticJobs } from "./fantastic-jobs";

/** Where Job Offers are stored. Satisfied by the web app's Job Offers module. */
export interface JobOfferStore {
  /** The Job Offer already captured from this source URL (ignoring tracking parameters), or null. */
  findBySourceUrl(url: string): Promise<JobOffer | null>;
  /** Stores a posting, or returns the stored Job Offer for the same posting; `created` when it was stored just now. */
  capture(
    input: { source: { url: string } } & Omit<JobOfferDetails, "postedAt" | "summary" | "sector" | "subsector">,
    capturedBy?: "candidate" | "guest",
    trusted?: { postedAt?: Date; summary?: string; sector?: string; subsector?: string; provenance?: Provenance },
  ): Promise<{ ok: true; jobOffer: JobOffer; created?: boolean } | { ok: false; errors: unknown[] }>;
}

export interface JobDiscoveryOptions {
  ai: AiLayer;
  jobOffers: JobOfferStore;
  /** Default: the global fetch. */
  fetch?: typeof globalThis.fetch;
  /** Where each call to a job board (Greenhouse, Lever, Ashby, APEC) and each page read on another site (by its domain) is recorded (AI Usage's external APIs). Default: nowhere. */
  externalApis?: ExternalApiLog;
  /** How the crawler introduces itself to sites (and the name robots.txt rules address). */
  userAgent?: string;
  /** Hosts whose terms of use forbid crawling. Default: FORBIDDEN_SITES. */
  forbiddenSites?: readonly string[];
  /**
   * When a run stops reading result pages; what it leaves out is DEFAULT_BUDGET's. A getter is asked on
   * each run: the worker's follows its Platform Settings, so a change applies to the next run (#299).
   */
  budget?: Partial<JobDiscoveryBudget> | (() => Partial<JobDiscoveryBudget>);
  /**
   * How the run searches the web (#402): the country favoured, the oldest posting kept, the results per query, the job
   * titles per language and the languages; what it leaves out is DEFAULT_WEB_SEARCH_SETTINGS'. A getter is asked on each
   * run: the worker's follows its Platform Settings, so a change applies to the next run.
   */
  search?: Partial<WebSearchSettings> | (() => Partial<WebSearchSettings>);
  /** For waiting out robots.txt Crawl-delay and timing the budget. Default: real time. */
  clock?: Clock;
  /**
   * France Travail's offers, searched first. Default: none (its status is then `off`).
   * A getter is asked on each run: the worker's follows its Provider Secrets (#208).
   */
  franceTravail?: FranceTravail | null | (() => FranceTravail | null);
  /**
   * Fantastic.jobs' ATS postings, searched after France Travail. Default: none (its status is then `off`).
   * A getter is asked on each run: the worker's follows its Provider Secret (FANTASTIC_JOBS_API_KEY).
   */
  fantasticJobs?: FantasticJobs | null | (() => FantasticJobs | null);
  /**
   * The Job discovery sources and sites Administrators set in the Back Office, read at the start
   * of each run. Default, and when it throws: every source on, no site listed.
   */
  settings?: () => Promise<JobDiscoverySettings>;
  /**
   * The task Playbooks (ADR-0026), read at the start of each run: "job-search-queries" words the
   * queries (default: its built-in text), and "job-offer-reading", while one is served, has the
   * Job Offer Summary and sector written when the LLM reads a page (default: none written).
   */
  taskPlaybooks?: TaskPlaybookReader;
  /**
   * The NAF and ROME-domain labels (#236), read at the start of each run: the web searches name the
   * Sectors wanted by them. Default, and when it throws: none, so no Sector is named.
   */
  industries?: () => Promise<IndustryReference>;
}

export interface DiscoverRequest {
  /** The Candidate the search runs for (for AI usage and Plan Quotas). */
  candidateId: string;
  criteria: SearchCriteria;
  /** Where each step of the run goes as it starts and ends (the Job Search's progress). Default: nowhere. */
  onEvent?: (event: ProvenanceEvent) => void;
  /**
   * Stops the run (the Candidate stopped their Job Search, #331): once it aborts, no step starts any more, the AI call
   * on its way is stopped (its step `stopped`), and the run reports what it found until then, as when its budget is spent.
   */
  signal?: AbortSignal;
}

/**
 * Why a result page gave no Job Offer. `too_old`: its Posting date (stated by
 * its ATS, its JobPosting data or the search provider, or stored with the Job
 * Offer it leads to) is more than MAX_POSTING_AGE_DAYS ago. `site_disabled`: it is on a Job
 * discovery site an Administrator disabled.
 */
export type SkipReason = RefusalReason | "not_a_job_offer" | "invalid" | "too_old" | "site_disabled";
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
  /** The estimated cost in € of the run's AI calls: the job title step, each web search and each page the LLM read. */
  costEur: number;
  /** France Travail's part of the run (its offers are in the funnel too). */
  franceTravail: FranceTravailMetrics;
  /** Fantastic.jobs' part of the run (its offers are in the funnel too), with its estimated cost, not in `costEur`. */
  fantasticJobs: FantasticJobsMetrics;
  /** The run's switch to the fallback Search provider, once the active one failed (ADR-0043); null when it did not. */
  searchFallback: SearchFallback | null;
  /** Each web search of the run, in order, with what it gave (#404): one that failed is not there. */
  searches: DiscoverySearch[];
  /** Of `jobOffers`, how many were stored for the first time by this run. */
  newJobOffers: number;
  /** Why the run ended. */
  stopReason: DiscoveryStopReason;
  /**
   * The run's steps, recorded as it ran: the caller records its own after it (the Match Scores) and stores
   * `run.provenance()`, the run's Provenance, folded, with its wall-clock time until then.
   */
  run: ProvenanceRecorder;
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

export { DEFAULT_USER_AGENT } from "@jobhub/shared/page-reading";

/**
 * Sites whose terms of use forbid automated access (ADR-0002). They are covered
 * only by the browser extension, which captures what the Candidate is viewing.
 * Shared with the Back Office, which never lets them be a Job discovery site.
 */
export { FORBIDDEN_SITES } from "@jobhub/shared";

/** A job API searched before the web (France Travail, Fantastic.jobs): what Job discovery needs of it. */
interface JobApi {
  search(
    criteria: SearchCriteria,
    options: { max: number; now: Date; location?: string },
  ): Promise<
    | { ok: true; offers: { url: string; details: JobOfferDetails }[]; calls: number; costEur?: number }
    | { ok: false; reason: "refused" | "failed"; detail: string; calls: number }
  >;
}

/**
 * One web search of a run: queries of the Job Search's plan, as many as one call of the Search provider takes
 * (ADR-0043), or the plan's first query restricted to one Job discovery site.
 */
interface PlannedSearch {
  queries: JobSearchQuery[];
  /** The Job discovery site the search is restricted to. */
  site?: string;
}

/** `items` in groups of `size` (at least 1), in order. */
function inGroupsOf<T>(items: readonly T[], size: number): T[][] {
  const step = Math.max(1, Math.floor(size));
  const groups: T[][] = [];
  for (let first = 0; first < items.length; first += step) groups.push(items.slice(first, first + step));
  return groups;
}

/** The Sectors' labels; when they cannot be read, the run goes on without naming any. */
async function readIndustries(industries: JobDiscoveryOptions["industries"]): Promise<IndustryReference> {
  if (!industries) return NO_INDUSTRY_REFERENCE;
  try {
    return await industries();
  } catch (error) {
    console.warn(`[job-discovery] the Sectors' labels could not be read, the web searches name none: ${error instanceof Error ? error.message : String(error)}`);
    return NO_INDUSTRY_REFERENCE;
  }
}

/** Where the Back Office's settings come from; when they cannot be read, the run goes on with the defaults. */
async function readSettings(settings: JobDiscoveryOptions["settings"]): Promise<JobDiscoverySettings> {
  if (!settings) return DEFAULT_JOB_DISCOVERY_SETTINGS;
  try {
    return await settings();
  } catch (error) {
    console.warn(`[job-discovery] the Job discovery sources and sites could not be read, every source is searched: ${error instanceof Error ? error.message : String(error)}`);
    return DEFAULT_JOB_DISCOVERY_SETTINGS;
  }
}

export function createJobDiscovery(options: JobDiscoveryOptions): JobDiscovery {
  const clock = options.clock ?? realClock;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const forbiddenSites: readonly string[] = options.forbiddenSites ?? FORBIDDEN_SITES;

  return {
    async discover({ candidateId, criteria, onEvent, signal }) {
      const startedAt = clock.now();
      const budget: JobDiscoveryBudget = { ...DEFAULT_BUDGET, ...(typeof options.budget === "function" ? options.budget() : options.budget) };
      const web: WebSearchSettings = { ...DEFAULT_WEB_SEARCH_SETTINGS, ...(typeof options.search === "function" ? options.search() : options.search) };
      /**
       * What each web search asks of the provider, where it can: no forbidden site (none could be read, and most are
       * listing pages, #105), postings of the last 30 days by default (older ones are dropped), in France by default,
       * and as many results as the web search's settings say (#402).
       */
      const searchFilters: SearchFilters = { excludeDomains: [...forbiddenSites], maxAgeDays: web.maxPostingAgeDays, country: web.country, maxResults: web.resultsPerQuery };
      const tooOld = (postedAt: Date | undefined, now: Date) => isPostingTooOld(postedAt, now, web.maxPostingAgeDays);
      const settings = await readSettings(options.settings);
      const industries = await readIndustries(options.industries);
      const configuredFranceTravail = typeof options.franceTravail === "function" ? options.franceTravail() : options.franceTravail;
      const franceTravail = settings.sources.france_travail ? configuredFranceTravail : null;
      const configuredFantasticJobs = typeof options.fantasticJobs === "function" ? options.fantasticJobs() : options.fantasticJobs;
      const fantasticJobs = settings.sources.fantastic_jobs ? configuredFantasticJobs : null;
      /** Job discovery sites searched on purpose; a forbidden site never is, whatever the settings say. */
      const searchedSites = settings.sites.filter((site) => site.enabled && !isForbiddenSite(site.domain, forbiddenSites)).map((site) => site.domain);
      const disabledSites = settings.sites.filter((site) => !site.enabled).map((site) => site.domain);
      const onDisabledSite = (url: string) => {
        try {
          const { hostname } = new URL(url);
          return disabledSites.some((domain) => isOnDomain(hostname, domain));
        } catch {
          return false;
        }
      };
      const fetch = options.fetch ?? globalThis.fetch;
      const fetcher = createPoliteFetcher({
        fetch: options.externalApis ? recordingSiteFetch(fetch, options.externalApis) : fetch,
        userAgent,
        forbiddenSites,
        timeoutMs: 15_000,
        maxBytes: 3 * 1024 * 1024,
        clock,
      });
      const found = new Map<string, JobOffer>();
      const ai = costing(stoppable(options.ai, signal), (eur) => (report.costEur += eur));
      const run = createProvenanceRecorder(ai, { now: () => new Date(clock.now()), onEvent });
      const report: DiscoveryReport = {
        jobOffers: [],
        skipped: [],
        funnel: { providerUrls: 0, fetched: 0, extracted: 0, alreadyStored: 0 },
        costEur: 0,
        franceTravail: { status: "off", offers: 0, calls: 0 },
        fantasticJobs: { status: "off", offers: 0, calls: 0, costEur: 0 },
        searchFallback: null,
        searches: [],
        newJobOffers: 0,
        stopReason: "exhausted",
        run,
      };
      /** The Job Offers this run stored for the first time. */
      const created = new Set<string>();
      /** The run's web searches: once the Search provider fails, the rest go to its fallback (ADR-0043). */
      const webSearches = createWebSearchRun();
      /** The steps of one search or one page read, for the Provenance of the Job Offers it leads to: steps of the run too. */
      const recording = () => run.part();
      /** `howFound`, the steps that led to a Job Offer, on the site of its page `url`. */
      const onItsPage = (howFound: Provenance | null, url: string) => {
        const page = recording();
        page.site(url);
        return joinProvenance(howFound, page.provenance());
      };
      const [queryWording, offerReading] = await Promise.all([
        taskRun(options.taskPlaybooks, "job-search-queries", options.ai),
        servedTaskRun(options.taskPlaybooks, "job-offer-reading", options.ai),
      ]);
      const offerReadingInstructions = offerReading?.instructions() ?? null;
      // Without its Search provider's key, the web search is skipped like a disabled source (#399); the other sources run.
      let webSearch = settings.sources.web_search;
      if (webSearch && !options.ai.webSearchAvailable(queryWording.searchRoute)) {
        webSearch = false;
        console.warn("[job-discovery] the web search is unavailable (its Search provider's key is missing): skipped, the other sources are searched");
      }
      const { funnel, skipped } = report;
      /** The share of the budget the location being searched may use up to (k/n for the k-th of n locations). */
      let share = 1;
      // The Candidate stopping the run spends it too: no step starts after.
      const budgetSpent = () =>
        signal?.aborted === true ||
        found.size >= budget.jobOffers * share ||
        report.costEur >= budget.spendEur * share ||
        clock.now() - startedAt >= budget.seconds * 1000 * share;
      /** Each ATS API URL's answer in this run: an Ashby board holds all its employer's postings, downloaded once. */
      const atsAnswers = new Map<string, Promise<JsonResult>>();
      const fetchAtsJson = (api: string) => {
        let answer = atsAnswers.get(api);
        if (!answer) atsAnswers.set(api, (answer = fetcher.json(api)));
        return answer;
      };
      /** URLs looked at in this run, so a posting a listing page links to is not read twice. */
      const seen = new Set<string>();
      const storedAt = (url: string) => options.jobOffers.findBySourceUrl(url).catch(() => null);
      /**
       * Lists a Job Offer stored by an earlier run (or earlier in this one) that `url` leads to, unless its Posting
       * date is now more than 30 days ago: the freshness rule holds for every Job Offer a Job Search finds, stored or not.
       */
      const alreadyStored = (url: string, jobOffer: JobOffer) => {
        if (tooOld(jobOffer.postedAt, new Date(clock.now()))) {
          skipped.push({ url, reason: "too_old" });
          return;
        }
        found.set(jobOffer.id, jobOffer);
        funnel.alreadyStored++;
      };

      /**
       * Stores the posting read at `url` as a Job Offer (or finds the one stored for it), unless its Posting date is
       * more than 30 days ago. That date is the one its ATS or its JobPosting data states, else the search provider's
       * (`searchDate`, weaker: it may be when the page was last updated); a date in the future is no date.
       * The store may answer with a Job Offer stored earlier with the same text (a mirror, an aggregator): that one
       * keeps its own Posting date, so the rule is applied to it too. `howFound`: the steps that led to it, for its Provenance.
       */
      const capture = async (url: string, details: JobOfferDetails, searchDate: Date | undefined, howFound: Provenance | null) => {
        const now = new Date(clock.now());
        const { postedAt: stated, summary, sector, subsector, ...untrusted } = details;
        const postedAt = believablePostingDate(stated, now) ?? believablePostingDate(searchDate, now);
        if (tooOld(postedAt, now)) {
          skipped.push({ url, reason: "too_old" });
          return;
        }
        funnel.extracted++;
        // The Posting date is what the worker read from the source itself, and the Job Offer Summary what its AI wrote
        // from the page: trusted, unlike anything a browser sends.
        const provenance = onItsPage(howFound, url);
        const trusted = {
          ...(postedAt && { postedAt }),
          ...(summary && { summary }),
          ...(sector && { sector }),
          ...(subsector && { subsector }),
          ...(provenance && { provenance }),
        };
        const captured = await options.jobOffers.capture({ source: { url }, ...untrusted }, "candidate", trusted);
        if (!captured.ok) skipped.push({ url, reason: "invalid" });
        else if (tooOld(captured.jobOffer.postedAt, now)) skipped.push({ url, reason: "too_old" });
        else {
          found.set(captured.jobOffer.id, captured.jobOffer);
          if (captured.created) created.add(captured.jobOffer.id);
          report.newJobOffers = created.size;
        }
      };

      /**
       * Reads one page, and when `follow` and it is a listing page, the postings it links to.
       * `searchDate`: the date the search provider states for it; `howFound`: the steps that led to it.
       */
      const read = async (url: string, follow: boolean, searchDate: Date | undefined, howFound: Provenance | null): Promise<void> => {
        if (seen.has(url)) return;
        seen.add(url);
        if (onDisabledSite(url)) {
          skipped.push({ url, reason: "site_disabled" });
          return;
        }
        const known = await storedAt(url);
        if (known) {
          alreadyStored(url, known);
          return;
        }
        // A Greenhouse, Lever or Ashby posting is read through its ATS's JSON API, which states its date and status;
        // when that API cannot be read, its page is read below like any other.
        const reading = recording();
        const atsTool = settings.sources.ats_apis ? atsToolOf(url) : null;
        const ats = atsTool ? await reading.step({ tool: atsTool }, () => readAtsPosting(url, { fetchJson: fetchAtsJson, now: new Date(clock.now()), maxAgeDays: web.maxPostingAgeDays })) : null;
        if (ats) {
          if (!ats.ok) {
            skipped.push({ url, reason: ats.reason });
            return;
          }
          funnel.fetched++;
          await capture(url, ats.details, searchDate, joinProvenance(howFound, reading.provenance()));
          return;
        }
        // A result can redirect to a page captured earlier (in this run or before): use that Job Offer.
        const page = await reading.step({ tool: pageReadTool(url) }, () => fetcher.page(url, storedAt));
        if (page.ok === "known") {
          alreadyStored(url, page.known);
          return;
        }
        if (!page.ok) {
          skipped.push({ url, reason: page.reason });
          return;
        }
        funnel.fetched++;
        // The postings of a listing page are read too, one level only, while the budget lasts.
        const links = follow ? listingPageLinks(page) : [];
        const followListing = async () => {
          for (const link of links) {
            if (budgetSpent()) break;
            await read(link, false, undefined, joinProvenance(howFound, reading.provenance()));
          }
        };
        // A page asking not to be indexed is never a Job Offer; its links may still be followed, unless it says nofollow.
        if (metaRobots(page.html).some((value) => /\b(noindex|none)\b/.test(value))) {
          skipped.push({ url, reason: "robots" });
          await followListing();
          return;
        }
        let details = readJobPosting(page.html);
        if (!details && links.length > 0) {
          skipped.push({ url, reason: "not_a_job_offer" });
          await followListing();
          return;
        }
        if (!details && countJobPostings(page.html) <= 1) details = await readJobPage(reading.aiFor("read_job_page"), candidateId, htmlToText(page.html), offerReadingInstructions);
        if (!details) {
          skipped.push({ url, reason: "not_a_job_offer" });
          return;
        }
        await capture(page.url, details, searchDate, joinProvenance(howFound, reading.provenance()));
      };

      /**
       * A job API's offers (France Travail's, Fantastic.jobs') for the Search Criteria, no more than the budget's Job
       * Offers left, each captured like a posting read (at its page, dated by the API) or found stored, and counted in
       * its part of the report. Never throws. `tool`: the API, as its offers' Provenance names it.
       */
      const searchJobApi = async (api: JobApi, tool: StepTool, metrics: FranceTravailMetrics | FantasticJobsMetrics, location: string) => {
        const before = found.size;
        const max = Math.max(Math.ceil(budget.jobOffers * share) - found.size, 1);
        const searching = recording();
        const result = await searching.step({ tool }, () => api.search(criteria, { max, now: new Date(clock.now()), location }));
        const searched = searching.provenance();
        metrics.calls += result.calls;
        if (result.ok && result.costEur !== undefined && "costEur" in metrics) metrics.costEur = Math.round((metrics.costEur + result.costEur) * 1e6) / 1e6;
        // One location searched is enough for the run to have searched the API.
        if (metrics.status !== "searched") metrics.status = result.ok ? "searched" : result.reason;
        for (const offer of result.ok ? result.offers : []) {
          if (budgetSpent()) break;
          if (seen.has(offer.url)) continue;
          seen.add(offer.url);
          const known = await storedAt(offer.url);
          if (known) alreadyStored(offer.url, known);
          else await capture(offer.url, offer.details, undefined, searched);
        }
        metrics.offers += found.size - before;
      };

      /** URLs the provider gave in this run, each counted once in the funnel. */
      const providerUrls = new Set<string>();
      /** The job titles to search, planned once for every location. */
      let plan: Awaited<ReturnType<AiLayer["planJobSearch"]>> | undefined;

      /** The web searches for one location, within its share of the budget. */
      const searchTheWeb = async (location: string) => {
        plan ??= await run.ai.planJobSearch({
          candidateId,
          criteria,
          instructions: {
            titles: queryWording.instructions("intitulés"),
            openings: { fr: queryWording.text("requête fr"), en: queryWording.text("requête en") },
          },
          // Its searches go to the web-search provider the task Playbook names (else the configured one): paged as it pages.
          route: queryWording.searchRoute,
          // As many job titles per language, in the languages, the web search's settings say (#402).
          shape: { titlesPerLanguage: web.titlesPerLanguage, languages: web.queryLanguages },
        });
        // The plan's queries go in as few calls as the provider takes; each Job discovery site is searched on purpose
        // too: the plan's first query, restricted to it.
        const first = plan.queries[0];
        const planned: PlannedSearch[] = [
          ...inGroupsOf(plan.queries, plan.queriesPerCall).map((queries) => ({ queries })),
          ...(first ? searchedSites.map((site) => ({ queries: [first], site })) : []),
        ];
        const pager = searchPages(planned, plan.pages);
        for (let next = pager.next(); next && !budgetSpent(); next = pager.next()) {
          const before = found.size;
          const { queries, site } = next.query;
          const filters = site ? { ...searchFilters, includeDomains: [site] } : searchFilters;
          const searching = recording();
          const search = await searching.ai
            .searchWeb({ candidateId, criteria, queries, page: next.page, filters, location, route: queryWording.searchRoute, industries, warnings: queryWording.warnings, run: webSearches })
            .finally(() => (report.searchFallback = webSearches.fallback));
          const searched = searching.provenance();
          // The answer text only points at pages to read: a Job Offer always comes from a page read.
          const given = [...new Set([...search.sources, ...urlsIn(search.answer)])];
          const fresh = given.filter((url) => !providerUrls.has(url));
          for (const url of fresh) providerUrls.add(url);
          funnel.providerUrls = providerUrls.size;
          // Recorded before its pages are read, so a run failing while reading them still lists it.
          const fallback = webSearches.fallback;
          const recorded: DiscoverySearch = {
            kind: site ? "site" : "plan",
            ...(site ? { site } : {}),
            queries: search.queries ?? [],
            page: next.page,
            provider: search.provider,
            fallback: fallback !== null && search.provider === fallback.to,
            results: given.length,
            newJobOffers: 0,
            costEur: Math.round(costInEur(search) * 1e6) / 1e6,
          };
          report.searches.push(recorded);
          const createdBefore = created.size;
          for (const url of fresh) {
            if (budgetSpent()) break;
            await read(url, true, search.sourceDates?.[url], searched);
            recorded.newJobOffers = created.size - createdBefore;
          }
          pager.gave(next, found.size - before);
        }
      };

      try {
        const { locations } = criteria;
        // Fantastic.jobs is searched once a run, at the first location the budget leaves room for: every call
        // spends one of its plan's API requests (a hard limit) and its jobs Jobs credits (ADR-0031).
        let fantasticJobsSearched = false;
        for (const [index, location] of locations.entries()) {
          share = (index + 1) / locations.length;
          if (franceTravail && !budgetSpent()) await searchJobApi(franceTravail, "france-travail", report.franceTravail, location);
          if (fantasticJobs && !fantasticJobsSearched && !budgetSpent()) {
            fantasticJobsSearched = true;
            await searchJobApi(fantasticJobs, "fantastic-jobs", report.fantasticJobs, location);
          }
          if (budgetSpent() || !webSearch) continue;
          try {
            await searchTheWeb(location);
          } catch (error) {
            // Its key cleared during the run: the web search is skipped from now on, as when unavailable at its start.
            if (!(error instanceof WebSearchUnavailable)) throw error;
            webSearch = false;
            console.warn(`[job-discovery] the web search became unavailable during the run: ${error.message}`);
          }
        }
      } catch (error) {
        report.jobOffers = [...found.values()];
        // Stopped by the Candidate, the AI call on its way broke: the run reports what it found, as when stopped between steps.
        if (signal?.aborted) {
          report.stopReason = "stopped";
          return report;
        }
        report.stopReason = "failed";
        throw new JobDiscoveryError(report, error);
      }
      report.jobOffers = [...found.values()];
      // The whole budget, whichever location the run ended on.
      report.stopReason = signal?.aborted
        ? "stopped"
        : found.size >= budget.jobOffers
          ? "job_offers"
          : report.costEur >= budget.spendEur
            ? "spend"
            : clock.now() - startedAt >= budget.seconds * 1000
              ? "duration"
              : "exhausted";
      return report;
    },
  };
}

/** The web addresses written in a text, in order (a Markdown link's too), without the punctuation that follows them. */
function urlsIn(text: string): string[] {
  return (text.match(/https?:\/\/[^\s<>"'`()[\]{}«»]+/g) ?? []).map((url) => url.replace(/[.,;:!?]+$/, ""));
}

/** The AI layer, each call it sends stopped once `signal` aborts (#331). Without a signal, the layer itself. */
function stoppable(ai: AiLayer, signal: AbortSignal | undefined): AiLayer {
  if (!signal) return ai;
  return {
    generate: (request) => ai.generate({ ...request, signal }),
    // The job title step is short, and never fails: it runs to its end.
    planJobSearch: (request) => ai.planJobSearch(request),
    searchWeb: (request) => ai.searchWeb({ ...request, signal }),
    searchCompany: (request) => ai.searchCompany({ ...request, signal }),
    searchCompanyNews: (request) => ai.searchCompanyNews({ ...request, signal }),
    searchCompanyNewsWithCall: (request) => ai.searchCompanyNewsWithCall({ ...request, signal }),
    agentModels: () => ai.agentModels(),
    searchModels: () => ai.searchModels(),
    webSearchAvailable: (route) => ai.webSearchAvailable(route),
    forEval: () => stoppable(ai.forEval(), signal),
  };
}

/** The AI layer, telling `spend` the cost in € of each call made through it. */
function costing(ai: AiLayer, spend: (eur: number) => void): AiLayer {
  return {
    async generate(request) {
      const result = await ai.generate(request);
      spend(costInEur(result));
      return result;
    },
    async planJobSearch(request) {
      const plan = await ai.planJobSearch(request);
      if (plan.call) spend(costInEur(plan.call));
      return plan;
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
    // Only a Company Dossier searches for Company News: Job discovery never does.
    searchCompanyNews: (request) => ai.searchCompanyNews(request),
    searchCompanyNewsWithCall: (request) => ai.searchCompanyNewsWithCall(request),
    agentModels: () => ai.agentModels(),
    searchModels: () => ai.searchModels(),
    webSearchAvailable: (route) => ai.webSearchAvailable(route),
    forEval: () => costing(ai.forEval(), spend),
  };
}
