import type { JobSearchQuery } from "@jobhub/ai";

/** One web search of a Job Search: a query of its plan, and which page of its results. */
export interface SearchPage<Query = JobSearchQuery> {
  query: Query;
  /** From 1. */
  page: number;
}

export interface SearchPager<Query = JobSearchQuery> {
  /** The next page to search, or undefined when there is none left. */
  next(): SearchPage<Query> | undefined;
  /** How many new readable postings a searched page gave: Job Offers the run had not found before it. */
  gave(searched: SearchPage<Query>, newPostings: number): void;
}

/**
 * The paging stop rule of a Job Search (#112): the first page of every query, in the plan's
 * order, then a query's next page only while its last page gave at least one new readable
 * posting, up to the `pages` the web-search provider can give one query. Pages come in rounds,
 * so every query gets its first page before any gets a second. The caller still stops when the
 * Job discovery budget runs out.
 */
export function searchPages<Query = JobSearchQuery>(queries: readonly Query[], pages: number): SearchPager<Query> {
  const queue: SearchPage<Query>[] = queries.map((query) => ({ query, page: 1 }));
  return {
    next: () => queue.shift(),
    gave(searched, newPostings) {
      if (newPostings >= 1 && searched.page < pages) queue.push({ query: searched.query, page: searched.page + 1 });
    },
  };
}
