import { describe, expect, it } from "vitest";
import { mainHeading } from "./html";
import { readJobPosting, statedJobTitle } from "./job-posting";

const TITLE = "Senior Program Director – Delivery Management";
const BANNER = `<header class="site-header"><nav><a href="/">Avanade</a></nav><div class="hero"><h1>Doing what matters starts here</h1></div></header>`;
const page = (body: string, head = "") => `<html><head><title>Avanade Careers</title>${head}</head><body>${body}</body></html>`;
const jsonLd = (posting: Record<string, unknown>) => `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "JobPosting", ...posting })}</script>`;

describe("the posting's heading, never the site's slogan", () => {
  it("takes the <h1> of <main>, not the brand's slogan in the site's header", () => {
    expect(mainHeading(page(`${BANNER}<main><h1>${TITLE}</h1><p>Issy-les-Moulineaux</p></main>`))).toBe(TITLE);
  });

  it("takes the first <h1> outside the banner when the page has no <main>", () => {
    expect(mainHeading(page(`${BANNER}<div class="job"><h1><span>Senior Program Director</span> – Delivery&nbsp;Management</h1></div>`))).toBe(TITLE);
    expect(mainHeading(page(`<div role="banner"><h1>Doing what matters starts here</h1></div><section><h1>${TITLE}</h1></section>`))).toBe(TITLE);
  });

  it("finds none when the only <h1> is the slogan", () => {
    expect(mainHeading(page(`${BANNER}<main><h2>Le poste</h2></main>`))).toBeUndefined();
  });
});

describe("the job title a page states", () => {
  it("is its JobPosting's title, whatever its headings say", () => {
    const html = page(`${BANNER}<main><h1>Rejoignez-nous</h1></main>`, jsonLd({ title: TITLE, description: "<p>Vous pilotez la delivery.</p>" }));
    expect(statedJobTitle(html)).toEqual({ title: TITLE, from: "job_posting" });
  });

  it("is its JobPosting's title even when the node has no description to read the offer from", () => {
    const html = page(`${BANNER}<main><p>Vous pilotez la delivery.</p></main>`, jsonLd({ title: TITLE }));
    expect(readJobPosting(html)).toBeNull();
    expect(statedJobTitle(html)).toEqual({ title: TITLE, from: "job_posting" });
  });

  it("is the posting's heading when there is no JobPosting, never the banner's slogan", () => {
    expect(statedJobTitle(page(`${BANNER}<main><h1>${TITLE}</h1></main>`))).toEqual({ title: TITLE, from: "heading" });
    expect(statedJobTitle(page(`${BANNER}<main><p>Texte</p></main>`))).toBeUndefined();
  });
});
