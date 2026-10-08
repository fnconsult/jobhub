// Preloaded into the worker (NODE_OPTIONS=--import) by e2e/expired-job-offers.spec.ts
// to play the job sites whose postings the worker re-checks
// (job-offers.recheck-sources). Each site stands for one thing a source can say
// about a posting the Candidate saved earlier:
//  - still published (JobPosting JSON-LD valid until next year), until
//    E2E_RECHECK_PHASE=later, when the site answers 410 Gone;
//  - gone: 404 Not Found, or 410 Gone;
//  - past its JobPosting validThrough date;
//  - an "offre n'est plus disponible" notice on the page;
//  - redirected to the site's home page;
//  - a site whose robots.txt now forbids the page, one behind a Cloudflare
//    challenge, and LinkedIn (whose terms forbid crawling): none tells us anything.
// Every request is appended as one JSON line { url, method, headers } to
// E2E_RECHECK_LOG. Nothing reaches the network: any other host fails as if down.
import { appendFileSync } from "node:fs";

const tag = process.env.E2E_RECHECK_TAG ?? "local";
const phase = process.env.E2E_RECHECK_PHASE ?? "first";
const logFile = process.env.E2E_RECHECK_LOG;

const posting = (title, validThrough) => ({
  "@context": "https://schema.org",
  "@type": "JobPosting",
  title,
  description: `<p>${title} (réf. ${tag}).</p>`,
  hiringOrganization: { "@type": "Organization", name: "Acme Industrie" },
  validThrough,
});

const page = (title, body, head = "") =>
  `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${title}</title>${head}</head><body>${body}</body></html>`;
const jsonLd = (value) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
const html = (body, init = {}) =>
  new Response(body, { status: init.status ?? 200, headers: { "content-type": "text/html; charset=utf-8", ...init.headers } });
const text = (body, status = 200) => new Response(body, { status, headers: { "content-type": "text/plain" } });
const nextYear = `${new Date().getUTCFullYear() + 1}-12-31`;

const sites = {
  "encore-e2e.example": {
    robots: "User-agent: *\nAllow: /\n",
    pages: {
      [`/offre/${tag}`]: () =>
        phase === "later"
          ? html(page("Introuvable", "<p>Cette page n'existe plus.</p>"), { status: 410 })
          : html(page("DAF – Acme", "<h1>DAF</h1><p>Postulez avant la fin de l'année.</p>", jsonLd(posting("DAF", nextYear)))),
    },
  },
  "disparue-e2e.example": {
    robots: "",
    pages: {}, // every page answers 404
  },
  "retiree-e2e.example": {
    robots: "",
    pages: { [`/offre/${tag}`]: () => html(page("Retirée", "<p>Gone</p>"), { status: 410 }) },
  },
  "perimee-e2e.example": {
    robots: "",
    pages: {
      [`/offre/${tag}`]: () => html(page("Contrôleur de gestion", "<h1>Contrôleur de gestion</h1>", jsonLd(posting("Contrôleur de gestion", "2024-03-31")))),
    },
  },
  "pourvue-e2e.example": {
    robots: null, // no robots.txt (404): everything allowed
    pages: {
      [`/annonce/${tag}`]: () =>
        html(page("Responsable financier", "<h1>Responsable financier</h1><p>Désolé, cette offre n'est plus disponible.</p>")),
    },
  },
  "accueil-e2e.example": {
    robots: "",
    pages: {
      [`/emplois/${tag}`]: () => new Response(null, { status: 301, headers: { location: "/" } }),
      "/": () => html(page("Accueil", "<h1>Bienvenue chez Accueil Recrutement</h1><p>Nos dernières offres.</p>")),
    },
  },
  "bloque-e2e.example": {
    robots: "User-agent: *\nDisallow: /\n",
    pages: { [`/offre/${tag}`]: () => html(page("Offre", "<p>Ne devrait jamais être lu.</p>"), { status: 410 }) },
  },
  "protege-e2e.example": {
    robots: "",
    pages: {
      [`/offre/${tag}`]: () =>
        html(
          page("Just a moment...", `<div id="challenge"></div><script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>`),
          { status: 403, headers: { "cf-mitigated": "challenge" } },
        ),
    },
  },
  "www.linkedin.com": {
    robots: "",
    pages: { [`/jobs/view/${tag}`]: () => html(page("LinkedIn", "<p>Ne devrait jamais être lu.</p>"), { status: 404 }) },
  },
};

globalThis.fetch = async (input, init = {}) => {
  const request = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(request.url);
  if (logFile) appendFileSync(logFile, JSON.stringify({ url: url.toString(), method: request.method, headers: Object.fromEntries(request.headers) }) + "\n");

  const site = sites[url.hostname];
  if (!site) throw new TypeError(`fetch failed: ${url.hostname} is outside the e2e fake web`);
  if (url.pathname === "/robots.txt") return site.robots === null ? text("Not found", 404) : text(site.robots);
  const serve = site.pages[url.pathname];
  return serve ? serve() : html(page("Introuvable", "<p>404</p>"), { status: 404 });
};
