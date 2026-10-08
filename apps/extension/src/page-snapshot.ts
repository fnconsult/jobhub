import type { PageSnapshot } from "./job-page";

/** What `readJobPage` needs from the page the person is viewing, read in their own browser (ADR-0002). */
export function snapshotPage(document: Document): PageSnapshot {
  const main = document.querySelector<HTMLElement>("main, [role='main'], article") ?? document.body;
  return {
    url: document.location.href,
    title: document.title,
    heading: document.querySelector("h1")?.textContent?.trim() ?? "",
    siteName: document.querySelector<HTMLMetaElement>("meta[property='og:site_name']")?.content ?? "",
    structuredData: [...document.querySelectorAll("script[type='application/ld+json']")].map((script) => script.textContent ?? ""),
    text: main?.innerText ?? "",
  };
}
