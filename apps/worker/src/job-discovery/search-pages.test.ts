import { describe, expect, it } from "vitest";
import { searchPages, type SearchPage } from "./search-pages";

/** The pager never looks inside a query: it pages whatever the plan gives it. */
type Query = { title: string; language: "fr" | "en" };
const fr: Query = { title: "DAF", language: "fr" };
const en: Query = { title: "CFO", language: "en" };

/** Runs the pager, each searched page giving the new readable postings `gave` says, and lists the pages searched. */
function run(queries: Query[], pages: number, gave: (page: SearchPage<Query>) => number): string[] {
  const pager = searchPages(queries, pages);
  const searched: string[] = [];
  for (let page = pager.next(); page; page = pager.next()) {
    searched.push(`${page.query.title} p${page.page}`);
    pager.gave(page, gave(page));
  }
  return searched;
}

describe("paging a Job Search's queries", () => {
  it("searches the first page of every query, in the plan's order, even when one gives nothing new", () => {
    expect(run([fr, en], 1, () => 0)).toEqual(["DAF p1", "CFO p1"]);
  });

  it("searches a query's next page only while its last page gave at least one new readable posting", () => {
    const newPostings: Record<string, number> = { "DAF p1": 3, "DAF p2": 1, "DAF p3": 0, "CFO p1": 0 };

    expect(run([fr, en], 5, (page) => newPostings[`${page.query.title} p${page.page}`]!)).toEqual(["DAF p1", "CFO p1", "DAF p2", "DAF p3"]);
  });

  it("goes no further than the pages the web-search provider can give one query", () => {
    expect(run([fr, en], 2, () => 1)).toEqual(["DAF p1", "CFO p1", "DAF p2", "CFO p2"]);
  });

  it("searches nothing without queries", () => {
    expect(run([], 3, () => 1)).toEqual([]);
  });
});
