// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { readJobPage } from "./job-page";
import { postingHeading, snapshotPage } from "./page-snapshot";

// jsdom lays nothing out, so it has no innerText: the text as it stands is enough here.
if (!("innerText" in HTMLElement.prototype)) Object.defineProperty(HTMLElement.prototype, "innerText", { get(this: HTMLElement) { return this.textContent; } });

/** A careers page as Avanade's reads: the brand's slogan in the site's header, then the posting. */
function careersPage(body: string, head = ""): Document {
  document.documentElement.innerHTML = `<head><title>Senior Program Director – Delivery Management | Avanade Careers</title>${head}</head><body>${body}</body>`;
  return document;
}

const BANNER = `<header class="site-header"><nav><a href="/">Avanade</a></nav><div class="hero"><h1>Doing what matters starts here</h1></div></header>`;
const TITLE = "Senior Program Director – Delivery Management";

describe("the posting's heading, never the site's slogan", () => {
  it("takes the <h1> of <main>, not the brand's slogan in the site's header", () => {
    careersPage(`${BANNER}<main><h1>${TITLE}</h1><p>Issy-les-Moulineaux · CDI</p><p>Vous pilotez la delivery de programmes.</p></main>`);
    expect(postingHeading(document)).toBe(TITLE);
    expect(readJobPage(snapshotPage(document)).jobOffer?.title).toBe(TITLE);
  });

  it("keeps the <h1> of the posting's own <header>, inside its <article>", () => {
    careersPage(`${BANNER}<article><header><h1>${TITLE}</h1></header><p>Vous pilotez la delivery.</p></article>`);
    expect(postingHeading(document)).toBe(TITLE);
  });

  it("skips a slogan in a role=banner block too, and takes the next <h1> outside it", () => {
    careersPage(`<div role="banner"><h1>Doing what matters starts here</h1></div><div class="job"><h1>${TITLE}</h1><p>Vous pilotez la delivery.</p></div>`);
    expect(postingHeading(document)).toBe(TITLE);
  });

  it("reads the page's title when the only <h1> is the slogan", () => {
    careersPage(`${BANNER}<main><h2>Le poste</h2><p>Vous pilotez la delivery de programmes.</p></main>`);
    expect(postingHeading(document)).toBe("");
    expect(readJobPage(snapshotPage(document)).jobOffer?.title).toBe("Senior Program Director – Delivery Management | Avanade Careers");
  });

  it("takes the JobPosting's title over every heading", () => {
    const posting = { "@context": "https://schema.org", "@type": "jobPosting", title: TITLE, description: "<p>Vous pilotez la delivery.</p>", hiringOrganization: { name: "Avanade" } };
    careersPage(`${BANNER}<main><h1>Rejoignez-nous</h1></main>`, `<script type="application/ld+json">${JSON.stringify(posting)}</script>`);
    const read = readJobPage(snapshotPage(document));
    expect(read.detected).toBe(true);
    expect(read.jobOffer?.title).toBe(TITLE);
  });
});
