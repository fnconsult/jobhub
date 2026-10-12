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
