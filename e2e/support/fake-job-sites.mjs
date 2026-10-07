// Preloaded into the worker (NODE_OPTIONS=--import) by e2e/job-discovery.spec.ts
// to stand in for the whole outside world Job discovery talks to:
//  - Perplexity's Search API (api.perplexity.ai), which "finds" the result
//    pages listed in RESULT_PAGES below;
//  - Mistral's EU API (api.mistral.ai), which plays the LLM reading a page
//    that has no JobPosting structured data;
//  - the job sites themselves: a careers page with JobPosting JSON-LD, the same
//    posting mirrored on another site, a plain page only an LLM can read, a
//    page behind a Cloudflare challenge, one behind a CAPTCHA, one behind a
//    login wall, sites whose robots.txt says no, and LinkedIn (whose terms
//    forbid crawling).
// Every request the worker sends is appended, as one JSON line
// { url, method, headers, body }, to E2E_DISCOVERY_LOG, so the test can check
// what left the worker and what was never requested. Nothing reaches the network.
import { appendFileSync } from "node:fs";

const tag = process.env.E2E_DISCOVERY_TAG ?? "local";
const logFile = process.env.E2E_DISCOVERY_LOG;

/** The posting the careers site publishes as JobPosting JSON-LD (and the mirror site copies). */
const jsonLdPosting = {
  "@context": "https://schema.org",
  "@type": "JobPosting",
  title: `Directeur administratif et financier (H/F) – réf. ${tag}`,
  description: `<p>Acme Industrie recrute son DAF (réf. ${tag}).</p><p>Vous pilotez la finance du groupe. Poste basé à Lyon.</p>`,
  hiringOrganization: { "@type": "Organization", name: "Acme Industrie" },
  jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: "Lyon", postalCode: "69002" } },
  employmentType: "FULL_TIME",
  baseSalary: { "@type": "MonetaryAmount", currency: "EUR", value: { "@type": "QuantitativeValue", minValue: 110000, maxValue: 130000, unitText: "YEAR" } },
};

const page = (title, body, head = "") =>
  `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${title}</title>${head}</head><body>${body}</body></html>`;
const html = (body, init = {}) =>
  new Response(body, { status: init.status ?? 200, headers: { "content-type": "text/html; charset=utf-8", ...init.headers } });
const text = (body, status = 200) => new Response(body, { status, headers: { "content-type": "text/plain" } });

/** Text only an LLM could turn into a Job Offer: no structured data at all. */
const PLAIN_POSTING = `Responsable financier – réf. ${tag}. Cabinet Lumière recrute à Lyon un responsable financier en CDI.`;

const sites = {
  "carrieres.acme-e2e.example": {
    robots: "User-agent: *\nDisallow: /prive/\n",
    pages: {
      [`/offres/daf-lyon-${tag}`]: () =>
        html(
          page(
            "DAF – Acme Industrie",
            // What a visitor reads differs from the JSON-LD on purpose: the Job Offer must come from the JSON-LD.
            `<h1>Rejoignez-nous</h1><p>Texte de la page, pas celui de l'offre structurée.</p>`,
            `<script type="application/ld+json">${JSON.stringify(jsonLdPosting)}</script>`,
          ),
        ),
      [`/prive/daf-confidentiel-${tag}`]: () => html(page("Confidentiel", "<p>Ne devrait jamais être lu.</p>")),
    },
  },
  "miroir-e2e.example": {
    robots: "",
    pages: {
      [`/offre/daf-${tag}`]: () =>
        html(page("DAF (repris)", "<h1>Offre reprise</h1>", `<script type="application/ld+json">${JSON.stringify(jsonLdPosting)}</script>`)),
    },
  },
  "emplois.lyon-e2e.example": {
    robots: null, // no robots.txt (404): everything allowed
    pages: {
      [`/annonce/${tag}`]: () =>
        html(page("Responsable financier", `<header>Menu</header><article><h1>Responsable financier</h1><p>${PLAIN_POSTING}</p></article><footer>Mentions légales</footer>`)),
    },
  },
  "protege-e2e.example": {
    robots: "",
    pages: {
      // Cloudflare's managed challenge, as served to a bot.
      [`/offre/${tag}`]: () =>
        html(
          page("Just a moment...", `<div id="challenge"></div><script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>`),
          { status: 403, headers: { "cf-mitigated": "challenge" } },
        ),
    },
  },
  "captcha-e2e.example": {
    robots: "",
    pages: {
      [`/offre/${tag}`]: () =>
        html(page("Vérification", `<form><div class="g-recaptcha" data-sitekey="x"></div></form><script src="https://www.google.com/recaptcha/api.js"></script>`)),
    },
  },
  "membres-e2e.example": {
    robots: "",
    pages: {
      [`/offre/${tag}`]: () => new Response(null, { status: 302, headers: { location: `/connexion?retour=/offre/${tag}` } }),
      "/connexion": () => html(page("Connexion", `<form><input type="password" name="pw"></form>`)),
    },
  },
  "bloque-e2e.example": {
    robots: "User-agent: *\nDisallow: /\n",
    pages: { [`/offre/${tag}`]: () => html(page("Offre", `<p>Ne devrait jamais être lu.</p>`)) },
  },
  "deja-vu-e2e.example": {
    robots: "",
    pages: { [`/offre/${tag}`]: () => html(page("Déjà vu", `<p>Ne devrait pas être relu : l'offre est déjà enregistrée.</p>`)) },
  },
  "www.linkedin.com": {
    robots: "",
    pages: { [`/jobs/view/${tag}`]: () => html(page("LinkedIn", "<p>Ne devrait jamais être lu.</p>")) },
  },
};

/** What the fake web search returns, in order. */
export const RESULT_PAGES = [
  `https://carrieres.acme-e2e.example/offres/daf-lyon-${tag}`,
  `https://emplois.lyon-e2e.example/annonce/${tag}`,
  `https://www.linkedin.com/jobs/view/${tag}`,
  `https://protege-e2e.example/offre/${tag}`,
  `https://captcha-e2e.example/offre/${tag}`,
  `https://membres-e2e.example/offre/${tag}`,
  `https://bloque-e2e.example/offre/${tag}`,
  `https://carrieres.acme-e2e.example/prive/daf-confidentiel-${tag}`,
  `https://deja-vu-e2e.example/offre/${tag}`,
  `https://miroir-e2e.example/offre/daf-${tag}`,
];

function perplexity() {
  return Response.json({
    id: "pplx_e2e",
    model: "sonar",
    choices: [{ index: 0, message: { role: "assistant", content: "Voici des offres." }, finish_reason: "stop" }],
    search_results: RESULT_PAGES.map((url) => ({ url, title: "Offre" })),
    usage: { prompt_tokens: 20, completion_tokens: 40 },
  });
}

function mistral(body) {
  const prompt = String(body.messages?.at(-1)?.content ?? "");
  const reading = prompt.includes(PLAIN_POSTING)
    ? {
        isJobOffer: true,
        title: `Responsable financier (lu par l'IA) – réf. ${tag}`,
        content: PLAIN_POSTING,
        employer: "Cabinet Lumière",
        location: "Lyon",
        contractType: "cdi",
      }
    : { isJobOffer: false };
  return Response.json({
    id: "cmpl_e2e",
    model: body.model ?? "mistral-large-latest",
    choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(reading) }, finish_reason: "stop" }],
    usage: { prompt_tokens: 100, completion_tokens: 50 },
  });
}

globalThis.fetch = async (input, init = {}) => {
  const request = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(request.url);
  const body = request.method === "GET" || request.method === "HEAD" ? "" : await request.clone().text();
  if (logFile) {
    appendFileSync(
      logFile,
      JSON.stringify({ url: url.toString(), method: request.method, headers: Object.fromEntries(request.headers), body }) + "\n",
    );
  }

  if (url.origin === "https://api.perplexity.ai") return perplexity();
  if (url.origin === "https://api.mistral.ai") return mistral(JSON.parse(body || "{}"));

  const site = sites[url.hostname];
  if (!site) throw new TypeError(`fetch failed: ${url.hostname} is outside the e2e fake web`);
  if (url.pathname === "/robots.txt") return site.robots === null ? text("Not found", 404) : text(site.robots);
  const serve = site.pages[url.pathname];
  return serve ? serve() : html(page("Introuvable", "<p>404</p>"), { status: 404 });
};
