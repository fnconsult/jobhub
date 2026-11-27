import type { PageSnapshot } from "./job-page";

/** The site's banner and menus: a heading there (a brand's slogan, « Doing what matters starts here ») is never the posting's. */
const BANNER = "nav, [role='banner'], [role='navigation']";
const MAIN = "main, [role='main'], article";
/**
 * A job board's pane holding the posting open beside its list of results: LinkedIn's search view. The posting's
 * heading and text are read there, not among the results'.
 */
const POSTING_PANE = ".jobs-search__job-details, .scaffold-layout__detail";

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
  const pane = document.querySelector(POSTING_PANE);
  const headings = [...(pane ?? document).querySelectorAll("h1")].filter((heading) => (heading.textContent ?? "").trim() !== "" && !inBanner(heading));
  const heading = headings.find((candidate) => candidate.closest(MAIN)) ?? headings[0];
  return heading?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

/** Whether a page is laid out: a frame in display: none (a hidden captcha's, say) has no size. */
export function pageShown(view: Pick<Window, "innerWidth" | "innerHeight">): boolean {
  return view.innerWidth > 0 && view.innerHeight > 0;
}

/**
 * An element's text as the person reads it. A page that is not laid out gives, as its innerText, all of its text,
 * that of its scripts and styles included: it is then read without them.
 */
export function pageText(element: HTMLElement, shown: boolean): string {
  if (shown) return element.innerText ?? "";
  const copy = element.cloneNode(true) as HTMLElement;
  copy.querySelectorAll("script, style, noscript, template").forEach((node) => node.remove());
  copy.querySelectorAll("br, p, div, li, h1, h2, h3, h4, h5, h6, tr, section").forEach((node) => node.after("\n"));
  return (copy.textContent ?? "").split("\n").map((line) => line.trim()).filter(Boolean).join("\n");
}

/** What `readJobPage` needs from the page the person is viewing, read in their own browser (ADR-0002). */
export function snapshotPage(document: Document): PageSnapshot {
  const main = document.querySelector<HTMLElement>(POSTING_PANE) ?? document.querySelector<HTMLElement>(MAIN) ?? document.body;
  const view = document.defaultView;
  return {
    url: document.location.href,
    title: document.title,
    heading: postingHeading(document),
    siteName: document.querySelector<HTMLMetaElement>("meta[property='og:site_name']")?.content ?? "",
    structuredData: [...document.querySelectorAll("script[type='application/ld+json']")].map((script) => script.textContent ?? ""),
    text: main ? pageText(main, view ? pageShown(view) : true) : "",
  };
}
