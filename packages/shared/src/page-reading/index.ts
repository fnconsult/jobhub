/**
 * Reading a public web page the way ADR-0002 allows, for the server only (Job discovery and source
 * re-checks in the worker, a Job Offer link pasted in the Coach Panel in the web app): the polite
 * page reader (robots.txt first, as ourselves, never a Forbidden site, giving up at the first sign
 * of bot protection), and just enough HTML reading to get a posting's text and JobPosting data.
 * Not in the package's root export: the browser extension bundles that one.
 */
export { decodeEntities, htmlToText, jsonLdBlocks, metaRobots } from "./html";
export { countJobPostings, jobPostingValidThrough, listedPostingUrls, readJobPosting } from "./job-posting";
export {
  createPoliteFetcher,
  pageReadTool,
  realClock,
  recordingSiteFetch,
  type Clock,
  type JsonResult,
  type PageResult,
  type PoliteFetchOptions,
  type RefusalReason,
} from "./polite-fetch";
export { robotsAllow, robotsCrawlDelay } from "./robots";

/** Who we say we are to every site we read. */
export const DEFAULT_USER_AGENT = "JobbboxBot/1.0 (+https://jobbbox.fr/robot)";
