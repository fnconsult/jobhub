import { describe, expect, it } from "vitest";
import { mainHeading } from "./html";
import { headingTitle, readJobPosting, statedJobTitle } from "./job-posting";

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

describe("a job board's heading, as far as the job title goes (#1154)", () => {
  const heading = (h1: string) => statedJobTitle(page(`<main><h1>${h1}</h1><p>Le poste.</p></main>`));

  it("ends with the gender marker: the employer or the recruiting firm after it is not the title", () => {
    expect(headingTitle("Responsable Grands Comptes H/F Cabinet Exemple")).toBe("Responsable Grands Comptes H/F");
    expect(headingTitle("Directrice de Projet F/H - Exemple Conseil")).toBe("Directrice de Projet F/H");
    expect(headingTitle("Chef de Produit (H/F) Exemple Digital")).toBe("Chef de Produit (H/F)");
    expect(headingTitle("Product Owner F/H/X · Exemple & Associés")).toBe("Product Owner F/H/X");
    expect(headingTitle("Projektleiter (m/w/d) Beispiel GmbH")).toBe("Projektleiter (m/w/d)");
    expect(heading("Responsable Grands Comptes H/F <span>Cabinet Exemple</span>")).toEqual({ title: "Responsable Grands Comptes H/F", from: "heading" });
  });

  it("leaves out the site's own name at its end, with no gender marker before it", () => {
    const named = (h1: string) => statedJobTitle(page(`<main><h1>${h1}</h1></main>`, `<meta property="og:site_name" content="Exemple Labs">`));
    expect(named("Head of R&amp;D, Exemple Labs")).toEqual({ title: "Head of R&D", from: "heading" });
    expect(named("Data Engineer - Exemple Labs")).toEqual({ title: "Data Engineer", from: "heading" });
    expect(named("Data Engineer chez Exemple Labs")).toEqual({ title: "Data Engineer", from: "heading" });
    expect(named("Exemple Labs Data Engineer")).toEqual({ title: "Exemple Labs Data Engineer", from: "heading" });
  });

  it("keeps a title with no gender marker as it is", () => {
    expect(headingTitle("Senior Program Director – Delivery Management")).toBe("Senior Program Director – Delivery Management");
    expect(headingTitle("Head of R&D, Exemple Labs")).toBe("Head of R&D, Exemple Labs");
  });

  it("leaves out a parenthesis the page cut off", () => {
    expect(headingTitle("Commercial terrain B2B : prospection des PME (m")).toBe("Commercial terrain B2B : prospection des PME");
    expect(headingTitle("Analyste données (CDI)")).toBe("Analyste données (CDI)");
  });

  it("is no title at all when it is a careers page's own heading", () => {
    for (const careers of ["Open Roles", "Open positions", "Careers", "Join us", "Nos offres d'emploi", "Rejoignez-nous", "Carrières", "Nous recrutons"]) {
      expect(heading(careers), careers).toBeUndefined();
    }
  });

  it("never touches a JobPosting's title", () => {
    const html = page(`<main><h1>Open Roles</h1></main>`, jsonLd({ title: "Responsable Grands Comptes H/F Cabinet Exemple" }));
    expect(statedJobTitle(html)).toEqual({ title: "Responsable Grands Comptes H/F Cabinet Exemple", from: "job_posting" });
  });
});
