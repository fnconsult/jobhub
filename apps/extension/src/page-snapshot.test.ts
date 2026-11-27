// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { readJobPage } from "./job-page";
import { pageShown, pageText, postingHeading, snapshotPage } from "./page-snapshot";

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

// LinkedIn's search view, as its markup reads (an invented posting): the list of results, then the open posting's detail pane.
function linkedInSearchView(): Document {
  const results = Array.from({ length: 8 }, (_, i) => `<li><a class="job-card-list__title" href="/jobs/view/41000000${10 + i}/">Poste fictif ${i}</a><span>Entreprise fictive ${i}</span></li>`).join("");
  document.documentElement.innerHTML = `<head><title>(3) Responsable des opérations solutions | Société Fictive | LinkedIn</title></head><body>
    <header class="global-nav"><nav><a href="/feed/">Accueil</a></nav></header>
    <main id="main" class="scaffold-layout__main">
      <div class="scaffold-layout__list"><h1 class="visually-hidden">Résultats de recherche</h1><ul>${results}</ul></div>
      <div class="scaffold-layout__detail jobs-search__job-details"><div class="jobs-search__job-details--container">
        <div class="job-details-jobs-unified-top-card__company-name"><a href="/company/fictive/">Société Fictive</a></div>
        <div class="job-details-jobs-unified-top-card__job-title"><h1><a href="/jobs/view/4100000001/">Responsable des opérations solutions</a></h1></div>
        <div>Lyon (Hybride)</div><button>Enregistrer</button><button>Postuler</button>
        <div id="job-details"><h2>À propos de l'offre d'emploi</h2><p>Vous structurez les opérations de l'équipe solutions.</p></div>
      </div></div>
    </main>`;
  return document;
}

describe("LinkedIn's search view: the posting open in its detail pane", () => {
  it("reads the posting's heading and text from the detail pane, not the list of results", () => {
    const snapshot = snapshotPage(linkedInSearchView());
    expect(snapshot.heading).toBe("Responsable des opérations solutions");
    expect(snapshot.text).toContain("Vous structurez les opérations de l'équipe solutions.");
    expect(snapshot.text).toContain("Société Fictive");
    expect(snapshot.text).not.toContain("Poste fictif");
  });
});

/**
 * LinkedIn's search view as the Beta saw it (2026-11-27, an invented posting): neither an <h1> for the posting nor
 * the detail pane's classes the extension knew, the description folded behind « … plus ».
 */
function linkedInSearchViewWithoutHeading(): Document {
  document.documentElement.innerHTML = `<head><title>(3) Head of Solution Operations | Fictional AI | LinkedIn</title></head><body>
    <header class="global-nav"><nav><a href="/feed/">Accueil</a></nav></header>
    <main id="main">
      <div class="jobs-list"><ul><li><a href="/jobs/view/4100000010/">Poste fictif</a></li></ul></div>
      <div class="jobs-detail"><a href="/company/fictional-ai/">Fictional AI</a>
        <p class="t-24">Head of Solution Operations</p><p>Paris (Hybride) · Temps plein</p>
        <div id="job-details"><h2>À propos de l'offre d'emploi</h2><p>You will build and scale the operations of our solutions team.</p>
          <span>Fluent English…</span><button>plus</button></div>
      </div>
    </main>`;
  return document;
}

describe("LinkedIn's search view when the posting has no heading (#1188)", () => {
  it("names the posting from the page's title without « | <employer> | LinkedIn »", () => {
    const read = readJobPage(snapshotPage(linkedInSearchViewWithoutHeading()));
    expect(read.jobOffer?.title).toBe("Head of Solution Operations");
    expect(read.jobOffer?.content).toContain("You will build and scale the operations of our solutions team.");
  });

  it("names it from LinkedIn's top card, whether or not its title is an <h1>", () => {
    linkedInSearchViewWithoutHeading();
    document.querySelector(".t-24")!.classList.add("job-details-jobs-unified-top-card__job-title");
    expect(postingHeading(document)).toBe("Head of Solution Operations");
  });
});

describe("a frame's page that is not shown", () => {
  /** A reCAPTCHA frame's page as it reads: two lines of text and a long inline script. */
  function captchaPage(): Document {
    document.documentElement.innerHTML = `<head><title>reCAPTCHA</title></head><body><div>Je ne suis pas un robot</div><script>recaptcha.anchor.Main.init("${"x".repeat(5000)}");</script><style>.x{}</style><noscript>Activez JavaScript</noscript><div>Confidentialité - Conditions</div></body>`;
    return document;
  }

  it("says whether the page is shown: a frame in display: none has no size", () => {
    captchaPage();
    expect(pageShown(window)).toBe(true);
    expect(pageShown({ innerWidth: 0, innerHeight: 0 })).toBe(false);
    expect(pageShown({ innerWidth: 300, innerHeight: 0 })).toBe(false);
  });

  it("never reads the text of its scripts and styles, which a page not laid out gives as its own", () => {
    const body = captchaPage().body;
    expect(pageText(body, false)).toBe("Je ne suis pas un robot\nConfidentialité - Conditions");
  });
});
