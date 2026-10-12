/**
 * The pass rule of the search provider benchmark (#111): which provider sends Job discovery
 * the most single-posting URLs on sites it may read (ADR-0002), per € of search.
 */

/** URL shapes of one posting on the boards and career sites French managers use. Anything else is a listing or search page. */
const SINGLE_POSTING = [
  /hellowork\.com\/[a-z-]+\/emplois\/\d+\.html$/,
  /francetravail\.fr\/offres\/recherche\/detail\/\w+$/,
  /meteojob\.com\/jobs\/\d+$/,
  /cadremploi\.fr\/emploi\/detail_offre\?offreId=\d+/,
  /emploi\.lefigaro\.fr\/offres-emploi\/\d+$/,
  /trabajo\.org\/offre-/,
  /roberthalf\.com\/.+-(fh|hf)$/,
  /apec\.fr\/.*\/detail-offre\//,
  /welcometothejungle\.com\/[a-z-]+\/companies\/[^/]+\/jobs\//,
  /michaelpage\.fr\/job-detail\//,
  /indeed\.[a-z.]+\/viewjob\?jk=/,
  /linkedin\.com\/jobs\/view\/\d+/,
  /jobs\.lever\.co\/[^/]+\/[0-9a-f-]{36}/,
  /myworkdayjobs\.com\/.+\/job\//,
  // Career sites and ATSs in general: a /job/ or /jobs/ path carrying a posting id.
  /\/jobs?\/[^?#]*(\d{4,}|[0-9a-f]{8}-[0-9a-f]{4}-)/,
];

/** Whether a search result points at one job posting, by its URL alone (not a listing, category or search page). */
export function isSinglePosting(url: string): boolean {
  return SINGLE_POSTING.some((shape) => shape.test(url));
}

/** Skip reasons for a page that was read: the site let Job discovery in (ADR-0002) and the page still existed. */
const READ = new Set(["not_a_job_offer", "invalid"]);

/** One Job Search of the benchmark: the provider's URLs, the pages that gave no Job Offer and why, and what it cost. */
export interface CaseRun {
  sources: string[];
  skipped: { url: string; reason: string }[];
  /** The web search's cost in € (the provider's fee and tokens). */
  searchEur: number;
  /** The whole Job Search's cost in €: the search plus the LLM reading pages. */
  costEur: number;
}

export interface ProviderScore {
  providerUrls: number;
  /** URLs that point at one posting. */
  singlePostings: number;
  /** The distinct single-posting URLs Job discovery read: not refused under ADR-0002, not gone, not unreachable. */
  readableSinglePostings: string[];
  searchEur: number;
  costEur: number;
  /** The pass rule: readable single postings per € of web search. */
  perSearchEur: number;
}

const euros = (n: number) => Number(n.toFixed(5));

/** How one provider did over all the benchmark's Search Criteria. */
export function scoreProvider(runs: CaseRun[]): ProviderScore {
  const readable = new Set<string>();
  let providerUrls = 0;
  let singlePostings = 0;
  for (const run of runs) {
    const reasons = new Map(run.skipped.map((skip) => [skip.url, skip.reason]));
    providerUrls += run.sources.length;
    for (const url of run.sources.filter(isSinglePosting)) {
      singlePostings++;
      const reason = reasons.get(url);
      if (reason === undefined || READ.has(reason)) readable.add(url);
    }
  }
  const searchEur = euros(runs.reduce((sum, run) => sum + run.searchEur, 0));
  return {
    providerUrls,
    singlePostings,
    readableSinglePostings: [...readable],
    searchEur,
    costEur: euros(runs.reduce((sum, run) => sum + run.costEur, 0)),
    perSearchEur: searchEur > 0 ? Number((readable.size / searchEur).toFixed(1)) : 0,
  };
}
