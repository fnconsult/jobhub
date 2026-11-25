import type { PageSnapshot } from "./job-page";

/** The site's banner and menus: a heading there (a brand's slogan, « Doing what matters starts here ») is never the posting's. */
const BANNER = "nav, [role='banner'], [role='navigation']";
const MAIN = "main, [role='main'], article";

/** A `<header>` of the page itself (not one inside `<main>` or `<article>`, which heads the posting) is the site's banner. */
function inBanner(element: Element): boolean {
  if (element.closest(BANNER)) return true;
  const header = element.closest("header");
  return header !== null && header.parentElement?.closest(MAIN) == null;
}

/**
 * The posting's heading: the first `<h1>` of `<main>` or `<article>`, else the first one outside the site's banner.
 * Empty when the only headings are the banner's: the job page's title is then read instead (#1128).
 */
export function postingHeading(document: Document): string {
  const headings = [...document.querySelectorAll("h1")].filter((heading) => (heading.textContent ?? "").trim() !== "" && !inBanner(heading));
  const heading = headings.find((candidate) => candidate.closest(MAIN)) ?? headings[0];
  return heading?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

/** What `readJobPage` needs from the page the person is viewing, read in their own browser (ADR-0002). */
export function snapshotPage(document: Document): PageSnapshot {
  const main = document.querySelector<HTMLElement>(MAIN) ?? document.body;
  return {
    url: document.location.href,
    title: document.title,
    heading: postingHeading(document),
    siteName: document.querySelector<HTMLMetaElement>("meta[property='og:site_name']")?.content ?? "",
    structuredData: [...document.querySelectorAll("script[type='application/ld+json']")].map((script) => script.textContent ?? ""),
    text: main?.innerText ?? "",
  };
}
