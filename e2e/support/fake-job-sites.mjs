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
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const tag = process.env.E2E_DISCOVERY_TAG ?? "local";
const logFile = process.env.E2E_DISCOVERY_LOG;
// While this file exists, Perplexity is down: every web search fails (HTTP 503).
const searchDownFlag = process.env.E2E_SEARCH_DOWN_FLAG;
// Volume mode (e2e/job-discovery-budget.spec.ts, #113): instead of the fixed RESULT_PAGES, the web
// search returns E2E_DISCOVERY_VOLUME_COUNT postings on volume-e2e.example. "jsonld" ones carry
// JobPosting structured data (no LLM call); "llm" ones only an LLM can read (one Mistral call each).
// Each takes E2E_DISCOVERY_VOLUME_DELAY_MS to answer.
const volume = process.env.E2E_DISCOVERY_VOLUME_COUNT
  ? {
      count: Number(process.env.E2E_DISCOVERY_VOLUME_COUNT),
      kind: process.env.E2E_DISCOVERY_VOLUME_KIND ?? "jsonld",
      delayMs: Number(process.env.E2E_DISCOVERY_VOLUME_DELAY_MS ?? 0),
    }
  : null;

/** When the careers site says it published its posting: 3 days ago, so it is a Posting date of the last 30 days (#116). */
const JSON_LD_DATE_POSTED = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

/**
 * The posting the careers site publishes as JobPosting JSON-LD (and the mirror site copies), dated.
 * The plain posting only an LLM can read states no date: it is undated.
 */
const jsonLdPosting = {
  "@context": "https://schema.org",
  "@type": "JobPosting",
  title: `Directeur administratif et financier (H/F) – réf. ${tag}`,
  datePosted: JSON_LD_DATE_POSTED,
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

// Listing mode (e2e/job-discovery-listing-pages.spec.ts, #114): when E2E_DISCOVERY_LISTING is set, the
// web search returns one listing page (7 postings, and links off its site) followed by one separate posting.
const listing = Boolean(process.env.E2E_DISCOVERY_LISTING);
const LISTING_HOST = "listing-e2e.example";
const LISTING_PAGE = `https://${LISTING_HOST}/offres-emploi?q=daf&ref=${tag}`;
const LISTING_POSTINGS = [1, 2, 3, 4, 5, 6, 7].map((n) => `https://${LISTING_HOST}/offres-emploi/${n}-daf-${tag}`);
const LISTING_OFF_SITE = `https://autre-e2e.example/offres-emploi/99-daf-${tag}`;
const LISTING_LATER = `https://autre-e2e.example/offres-emploi/42-daf-${tag}`;

function listingSite(url) {
  if (url.pathname === "/robots.txt") return text("");
  if (url.hostname === LISTING_HOST && url.pathname === "/offres-emploi") {
    const links = LISTING_POSTINGS.map((href, i) => `<li><a href="${new URL(href).pathname}">Offre ${i + 1}</a></li>`).join("");
    return html(page("Offres DAF", `<h1>Offres DAF à Lyon</h1><ul>${links}<li><a href="${LISTING_OFF_SITE}">Offre d'un autre site</a></li></ul>`));
  }
  const n = Number(/^\/offres-emploi\/(\d+)-daf-/.exec(url.pathname)?.[1]);
  if (!n || !url.pathname.endsWith(`-${tag}`)) return html(page("Introuvable", "<p>404</p>"), { status: 404 });
  const posting = { ...jsonLdPosting, title: `DAF listé ${n} – réf. ${tag}`, description: `<p>Poste listé ${n} (réf. ${tag}).</p>` };
  return html(page(`Poste ${n}`, "<h1>Offre</h1>", `<script type="application/ld+json">${JSON.stringify(posting)}</script>`));
}


// ATS mode (e2e/job-discovery-ats.spec.ts, #115): when E2E_DISCOVERY_ATS is set, the web search returns
// Greenhouse, Lever and Ashby posting URLs (fresh, too old, closed), and the ATSs' public JSON APIs answer
// for them. Their HTML pages and other employers' boards must never be requested.
const ats = Boolean(process.env.E2E_DISCOVERY_ATS);
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => Date.now() - n * DAY;
const ghBoard = `acme-gh-${tag}`;
const leverCo = `acme-lever-${tag}`;
const ashbyCo = `acme-ashby-${tag}`;
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const ATS_POSTINGS = {
  ghFresh: `https://job-boards.greenhouse.io/${ghBoard}/jobs/1001`,
  ghOld: `https://job-boards.greenhouse.io/${ghBoard}/jobs/1002`,
  ghClosed: `https://job-boards.greenhouse.io/${ghBoard}/jobs/1003`,
  ghDeadline: `https://job-boards.greenhouse.io/${ghBoard}/jobs/1004`,
  leverFresh: `https://jobs.lever.co/${leverCo}/${uuid(1)}`,
  leverOld: `https://jobs.lever.co/${leverCo}/${uuid(2)}`,
  ashbyFresh: `https://jobs.ashbyhq.com/${ashbyCo}/${uuid(3)}`,
  ashbyOld: `https://jobs.ashbyhq.com/${ashbyCo}/${uuid(4)}`,
  ashbyClosed: `https://jobs.ashbyhq.com/${ashbyCo}/${uuid(5)}`,
};
export const ATS_POSTED = { ghFresh: daysAgo(5), leverFresh: daysAgo(3), ashbyFresh: daysAgo(10) };
const ghPosting = (id, title, publishedMs, deadline = null) => ({
  id,
  title,
  company_name: "Acme GH",
  location: { name: "Lyon, France" },
  first_published: new Date(publishedMs).toISOString(),
  application_deadline: deadline,
  content: `&lt;p&gt;${title} (r&eacute;f. ${tag}) chez Acme GH.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Piloter le budget&lt;/li&gt;&lt;/ul&gt;`,
});
const leverPosting = (id, title, createdMs) => ({
  id,
  text: title,
  createdAt: createdMs,
  categories: { location: "Lyon" },
  workplaceType: "hybrid",
  descriptionPlain: `${title} (réf. ${tag}) chez Acme Lever.\n`,
  lists: [],
  additionalPlain: "",
});
const ashbyJob = (id, title, publishedMs) => ({
  id,
  title,
  location: "Lyon",
  publishedAt: new Date(publishedMs).toISOString(),
  isRemote: false,
  workplaceType: "OnSite",
  descriptionPlain: `${title} (réf. ${tag}) chez Acme Ashby.\n`,
});
const json = (data, status = 200) => Response.json(data, { status });

function atsSite(url) {
  if (url.pathname === "/robots.txt") return text("");
  const path = url.pathname;
  if (url.hostname === "boards-api.greenhouse.io") {
    const m = /^\/v1\/boards\/([^/]+)\/jobs\/(\d+)$/.exec(path);
    if (m?.[1] === ghBoard) {
      if (m[2] === "1001") return json(ghPosting(1001, `Directeur financier GH – ${tag}`, ATS_POSTED.ghFresh));
      if (m[2] === "1002") return json(ghPosting(1002, `Ancien poste GH – ${tag}`, daysAgo(45)));
      if (m[2] === "1004") return json(ghPosting(1004, `Poste GH clos – ${tag}`, daysAgo(2), new Date(daysAgo(1)).toISOString()));
    }
    return json({ error: "Job not found" }, 404);
  }
  if (url.hostname === "api.lever.co") {
    const m = /^\/v0\/postings\/([^/]+)\/([^/]+)$/.exec(path);
    if (m?.[1] === leverCo) {
      if (m[2] === uuid(1)) return json(leverPosting(uuid(1), `Directeur financier Lever – ${tag}`, ATS_POSTED.leverFresh));
      if (m[2] === uuid(2)) return json(leverPosting(uuid(2), `Ancien poste Lever – ${tag}`, daysAgo(60)));
    }
    return json({ ok: false, error: "Document not found" }, 404);
  }
  if (url.hostname === "api.ashbyhq.com") {
    const m = /^\/posting-api\/job-board\/([^/]+)$/.exec(path);
    if (m?.[1] === ashbyCo) {
      return json({
        apiVersion: "1",
        jobs: [
          ashbyJob(uuid(3), `Directeur financier Ashby – ${tag}`, ATS_POSTED.ashbyFresh),
          ashbyJob(uuid(4), `Ancien poste Ashby – ${tag}`, daysAgo(90)),
        ],
      });
    }
    return json({ error: "not found" }, 404);
  }
  // Anything else (the ATSs' HTML pages, other boards): not part of the e2e fake web.
  return html(page("Introuvable", "<p>404</p>"), { status: 404 });
}
const ATS_HOSTS = ["boards-api.greenhouse.io", "api.lever.co", "api.ashbyhq.com", "job-boards.greenhouse.io", "boards.greenhouse.io", "jobs.lever.co", "jobs.ashbyhq.com"];

// Freshness mode (e2e/job-freshness.spec.ts, #116): when E2E_DISCOVERY_FRESHNESS is set, the web search returns
// three otherwise identical JobPosting pages: one dated 3 days ago, one dated 45 days ago, one with no date.
// The undated one comes first, so ranking (not discovery order) has to put the dated one above it.
const freshness = Boolean(process.env.E2E_DISCOVERY_FRESHNESS);
const FRESHNESS_HOST = "fraicheur-e2e.example";
const FRESHNESS_PAGES = { sansDate: null, recente: 3, ancienne: 45 };
const freshnessUrl = (key) => `https://${FRESHNESS_HOST}/offre/${key}-${tag}`;

function freshnessSite(url) {
  if (url.pathname === "/robots.txt") return text("");
  const key = /^\/offre\/(sansDate|recente|ancienne)-/.exec(url.pathname)?.[1];
  if (!key || !url.pathname.endsWith(`-${tag}`)) return html(page("Introuvable", "<p>404</p>"), { status: 404 });
  const days = FRESHNESS_PAGES[key];
  const undated = { ...jsonLdPosting };
  delete undated.datePosted;
  const posting = {
    ...undated,
    title: `Directeur financier ${key} – réf. ${tag}`,
    // Not the same text as another posting, or Job discovery folds them into one Job Offer (a mirrored posting).
    description: `<p>Acme Industrie recrute son directeur financier (${key}, réf. ${tag}).</p><p>Vous pilotez la finance du groupe. Poste basé à Lyon.</p>`,
    ...(days === null ? {} : { datePosted: new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) }),
  };
  return html(page(`Poste ${key}`, "<h1>Offre</h1>", `<script type="application/ld+json">${JSON.stringify(posting)}</script>`));
}

// France Travail mode (e2e/job-discovery-france-travail.spec.ts, #120): when E2E_DISCOVERY_FT is set, France Travail's
// OAuth token endpoint and Offres d'emploi search answer as follows (the web search still returns the default pages):
//  - "ok": a token, then E2E_DISCOVERY_FT_COUNT offers (as many as the request's `range` allows), each created 2 days ago;
//  - "search-refused": a token, then HTTP 403 on the search; "token-refused": HTTP 401 on the token endpoint;
//  - "failed": a token, then HTTP 500 on the search.
// The offers' public pages (candidat.francetravail.fr) are never part of the fake web: they must never be requested.
const ftMode = process.env.E2E_DISCOVERY_FT ?? "";
const ftCount = Number(process.env.E2E_DISCOVERY_FT_COUNT ?? 3);
export const FT_CREATED_MS = Date.now() - 2 * 24 * 60 * 60 * 1000;
const ftOffer = (n) => ({
  id: `FT${tag}x${n}`,
  intitule: `Directeur administratif et financier France Travail ${n} – réf. ${tag}`,
  description: `Offre ${n} (réf. ${tag}) : vous pilotez la finance d'un groupe industriel lyonnais.`,
  dateCreation: new Date(FT_CREATED_MS).toISOString(),
  dateActualisation: new Date(Date.now() - 60_000).toISOString(),
  lieuTravail: { libelle: "69 - LYON 03", codePostal: "69003" },
  entreprise: { nom: "INDUSTRIES DU RHONE" },
  typeContrat: "CDI",
  salaire: { libelle: "Annuel de 110000.00 Euros à 130000.00 Euros" },
});

function franceTravailSite(url) {
  if (url.hostname === "entreprise.francetravail.fr") {
    if (ftMode === "token-refused") return json({ error: "invalid_client" }, 401);
    return json({ access_token: `ft-token-${tag}`, token_type: "Bearer", expires_in: 1499, scope: "api_offresdemploiv2 o2dsoffre" });
  }
  if (url.hostname === "api.francetravail.io") {
    if (ftMode === "search-refused") return json({ message: "forbidden" }, 403);
    if (ftMode === "failed") return json({ message: "boom" }, 500);
    const end = Number(/^0-(\d+)$/.exec(url.searchParams.get("range") ?? "")?.[1] ?? 14);
    return json({ resultats: Array.from({ length: Math.min(ftCount, end + 1) }, (_, n) => ftOffer(n + 1)) }, 206);
  }
  return html(page("Introuvable", "<p>404</p>"), { status: 404 });
}
const FT_HOSTS = ["entreprise.francetravail.fr", "api.francetravail.io", "candidat.francetravail.fr"];

// Fantastic.jobs mode (e2e/job-discovery-fantastic-jobs.spec.ts, #243): when E2E_DISCOVERY_FJ is set, Fantastic.jobs' active-ats
// answers a search made with the key E2E_DISCOVERY_FJ_KEY (any other: 401) as follows (the web search still returns the default pages):
//  - "ok": E2E_DISCOVERY_FJ_COUNT jobs (as many as the request's `limit` allows) shaped like the real answer captured in
//    apps/worker/src/job-discovery/fixtures/fantastic-jobs/active-ats.json, posted 2 days ago, with the count charged in x-api-jobs-this-request;
//  - "key-rejected": HTTP 401; "quota": HTTP 429; "failed": HTTP 500.
// The jobs' own pages (ATS sites) are never part of the fake web: they must never be requested.
const fjMode = process.env.E2E_DISCOVERY_FJ ?? "";
const fjCount = Number(process.env.E2E_DISCOVERY_FJ_COUNT ?? 3);
const fjKey = process.env.E2E_DISCOVERY_FJ_KEY ?? "";
export const FJ_POSTED_MS = Date.now() - 2 * 24 * 60 * 60 * 1000;
const fjFixture = JSON.parse(readFileSync(new URL("../../apps/worker/src/job-discovery/fixtures/fantastic-jobs/active-ats.json", import.meta.url), "utf8"));
const fjJob = (n) => {
  const base = fjFixture[(n - 1) % fjFixture.length];
  return {
    ...base,
    id: n,
    title: `${base.title} – Fantastic ${n} – réf. ${tag}`,
    url: `https://ats-e2e.example/fantastic/${tag}/${n}`,
    description_text: `${base.description_text}\n\nOffre Fantastic.jobs ${n} (réf. ${tag}).`,
    date_posted: new Date(FJ_POSTED_MS).toISOString().replace("Z", ""),
  };
};

function fantasticJobsSite(request, url) {
  const key = /^Bearer (.*)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  if (fjMode === "key-rejected" || key !== fjKey) return Response.json({ message: "Invalid API key" }, { status: 401 });
  if (fjMode === "quota") return Response.json({ message: "Monthly Jobs credits exhausted" }, { status: 429 });
  if (fjMode === "failed") return Response.json({ message: "boom" }, { status: 500 });
  const limit = Number(url.searchParams.get("limit") ?? 100);
  const jobs = Array.from({ length: Math.min(fjCount, limit) }, (_, n) => fjJob(n + 1));
  return Response.json(jobs, { headers: { "x-api-jobs-this-request": String(jobs.length) } });
}

const volumePage = (n) => `https://volume-e2e.example/offre/${n}-${tag}`;

/** What the fake web search returns, in order. */
export const RESULT_PAGES = freshness
  ? Object.keys(FRESHNESS_PAGES).map(freshnessUrl)
  : ats
  ? Object.values(ATS_POSTINGS)
  : listing
  ? [LISTING_PAGE, LISTING_LATER]
  : volume
  ? Array.from({ length: volume.count }, (_, n) => volumePage(n + 1))
  : [
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

/** Perplexity's Search API (POST /search) answering a web search: the result pages, undated. */
function perplexity() {
  return Response.json({
    id: "pplx_e2e",
    results: RESULT_PAGES.map((url) => ({ title: "Offre", url, snippet: "", date: null, last_updated: null })),
  });
}

/** Volume posting number `n`, distinct in title and text from every other. */
const volumeText = (n) => `Poste en volume ${n} – réf. ${tag}. Entreprise ${n} recrute à Lyon.`;

async function volumeSite(url) {
  if (url.pathname === "/robots.txt") return text("");
  const n = Number(/^\/offre\/(\d+)-/.exec(url.pathname)?.[1]);
  if (!n || !url.pathname.endsWith(`-${tag}`)) return html(page("Introuvable", "<p>404</p>"), { status: 404 });
  if (volume.delayMs) await new Promise((resolve) => setTimeout(resolve, volume.delayMs));
  if (volume.kind === "llm") return html(page(`Poste ${n}`, `<article><p>${volumeText(n)}</p></article>`));
  const posting = { ...jsonLdPosting, title: `Poste en volume ${n} – réf. ${tag}`, description: `<p>${volumeText(n)}</p>` };
  return html(page(`Poste ${n}`, "<h1>Offre</h1>", `<script type="application/ld+json">${JSON.stringify(posting)}</script>`));
}

/** The job title step of a Job Search (#112): it is given the Search Criteria title alone. */
const isJobTitleStep = (body) => String(body).includes("autres intitulés");

function mistral(body) {
  const prompt = String(body.messages?.at(-1)?.content ?? "");
  if (isJobTitleStep(JSON.stringify(body))) {
    return Response.json({
      id: "cmpl_e2e_titles",
      model: body.model ?? "mistral-large-latest",
      choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify({ fr: ["DAF"], en: ["Chief Financial Officer"] }) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    });
  }
  const volumeN = /Poste en volume (\d+) – réf\. /.exec(prompt)?.[1];
  const reading = volumeN
    ? { isJobOffer: true, title: `Poste en volume ${volumeN} – réf. ${tag}`, content: volumeText(volumeN), employer: `Entreprise ${volumeN}`, location: "Lyon", contractType: "cdi" }
    : prompt.includes(PLAIN_POSTING)
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

  if (url.origin === "https://api.perplexity.ai") {
    if (searchDownFlag && existsSync(searchDownFlag)) return Response.json({ error: { message: "e2e: Perplexity is down" } }, { status: 503 });
    return perplexity();
  }
  if (url.origin === "https://api.mistral.ai") return mistral(JSON.parse(body || "{}"));

  if (fjMode && url.hostname === "data.fantastic.jobs") return fantasticJobsSite(request, url);
  if (ftMode && FT_HOSTS.includes(url.hostname)) return franceTravailSite(url);
  if (freshness && url.hostname === FRESHNESS_HOST) return freshnessSite(url);
  if (ats && ATS_HOSTS.includes(url.hostname)) return atsSite(url);
  if (listing && (url.hostname === LISTING_HOST || url.hostname === "autre-e2e.example")) return listingSite(url);
  if (volume && url.hostname === "volume-e2e.example") return volumeSite(url);
  const site = sites[url.hostname];
  if (!site) throw new TypeError(`fetch failed: ${url.hostname} is outside the e2e fake web`);
  if (url.pathname === "/robots.txt") return site.robots === null ? text("Not found", 404) : text(site.robots);
  const serve = site.pages[url.pathname];
  return serve ? serve() : html(page("Introuvable", "<p>404</p>"), { status: 404 });
};
