// Preloaded into the worker (NODE_OPTIONS=--import) by e2e/job-discovery-target-companies.spec.ts (#406), AFTER
// e2e/support/fake-job-sites.mjs, whose fetch it wraps: what it does not answer goes on to that fake web (its default
// result pages, Mistral, the robots.txt of its sites). It stands in for what a Job Search's Target Companies reach:
//  - France Travail's token endpoint, as a client granted La Bonne Boite and ROMEO but not Offres d'emploi
//    (`invalid_scope`, as a new francetravail.io application is today);
//  - La Bonne Boite's /recherche, answering two companies for E2E_TC_TAG: ALPHACIBLE <tag> (SIRET E2E_TC_ALPHA_SIRET),
//    without a known careers site, and BETACIBLE <tag> (E2E_TC_BETA_SIRET), whose Lever board the spec keeps beforehand;
//    ROMEO's prediction (no code);
//  - geo.api.gouv.fr's communes: Lyon is 69123;
//  - Perplexity's Search API, for the one search « title + ALPHACIBLE <tag> »: a Greenhouse posting on ALPHACIBLE's board;
//  - Greenhouse's posting API for that posting, and Lever's board API for BETACIBLE's board (one posting for the job,
//    one not), with their robots.txt.
// Every request is appended to E2E_TC_LOG as one JSON line { url, method, headers, body }.
import { appendFileSync } from "node:fs";

const next = globalThis.fetch;
const tag = process.env.E2E_TC_TAG ?? "local";
const logFile = process.env.E2E_TC_LOG;
const alpha = { siret: process.env.E2E_TC_ALPHA_SIRET ?? "11111111100011", name: `ALPHACIBLE ${tag}` };
const beta = { siret: process.env.E2E_TC_BETA_SIRET ?? "22222222200022", name: `BETACIBLE ${tag}` };
const DAY = 24 * 60 * 60 * 1000;

export const ALPHA_BOARD = `alphacible-${tag}`;
export const BETA_BOARD = `betacible-${tag}`;
export const ALPHA_POSTING = `https://job-boards.greenhouse.io/${ALPHA_BOARD}/jobs/3001`;
const BETA_POSTING_ID = "00000000-0000-4000-8000-000000000406";

const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers });

const laBonneBoiteItem = (company, score) => ({
  siret: company.siret,
  company_name: company.name,
  office_name: company.name,
  naf_label: "Fabrication de machines",
  city: "Lyon",
  citycode: "69123",
  hiring_potential: score,
  is_high_potential: true,
});

const greenhousePosting = {
  id: 3001,
  title: `Directeur administratif et financier – ALPHACIBLE réf. ${tag}`,
  absolute_url: ALPHA_POSTING,
  company_name: alpha.name,
  location: { name: "Lyon" },
  first_published: new Date(Date.now() - 4 * DAY).toISOString(),
  application_deadline: null,
  content: `&lt;p&gt;ALPHACIBLE (réf. ${tag}) recrute son directeur administratif et financier à Lyon.&lt;/p&gt;`,
};

const leverPosting = (id, text, description) => ({
  id,
  text,
  hostedUrl: `https://jobs.lever.co/${BETA_BOARD}/${id}`,
  categories: { location: "Lyon", commitment: "CDI" },
  createdAt: Date.now() - 2 * DAY,
  descriptionPlain: description,
  lists: [],
  workplaceType: "hybrid",
});

function serve(request, url, body) {
  if (url.hostname === "entreprise.francetravail.fr") {
    const scope = new URLSearchParams(body).get("scope") ?? "";
    if (scope.includes("api_offresdemploiv2")) return json({ error: "invalid_scope", error_description: "Unknown/invalid scope(s): [api_offresdemploiv2, o2dsoffre]" }, 400);
    return json({ access_token: `tc-token-${tag}`, token_type: "Bearer", expires_in: 1499, scope });
  }
  if (url.hostname === "api.francetravail.io") {
    if (url.pathname === "/partenaire/labonneboite/v2/recherche") {
      return json({ hits: 2, items: [laBonneBoiteItem(alpha, 88), laBonneBoiteItem(beta, 71)] }, 200, { "x-ratelimit-remaining-clientidlimiter": "1" });
    }
    if (url.pathname === "/partenaire/romeo/v2/predictionMetiers") return json([]);
    return json({ message: "not found" }, 404);
  }
  if (url.hostname === "geo.api.gouv.fr" && url.pathname === "/communes") {
    return json(url.searchParams.get("nom")?.toLowerCase() === "lyon" ? [{ code: "69123", nom: "Lyon" }] : []);
  }
  if (url.origin === "https://api.perplexity.ai" && body.includes(alpha.name)) {
    return json({ id: "pplx_e2e_target", results: [{ title: "Directeur administratif et financier", url: ALPHA_POSTING, snippet: "", date: null, last_updated: null }] });
  }
  if (url.hostname === "boards-api.greenhouse.io" || url.hostname === "api.lever.co") {
    if (url.pathname === "/robots.txt") return new Response("", { status: 404 });
    if (url.pathname === `/v1/boards/${ALPHA_BOARD}/jobs/3001`) return json(greenhousePosting);
    if (url.pathname === `/v0/postings/${BETA_BOARD}`) {
      return json([
        leverPosting(BETA_POSTING_ID, `Directeur financier groupe – BETACIBLE réf. ${tag}`, `BETACIBLE (réf. ${tag}) cherche son directeur financier, basé à Lyon.`),
        leverPosting("00000000-0000-4000-8000-000000000407", `Technicien de maintenance – BETACIBLE réf. ${tag}`, `Maintenance (réf. ${tag}).`),
      ]);
    }
    return json({ message: "not found" }, 404);
  }
  return null;
}

globalThis.fetch = async (input, init = {}) => {
  const request = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(request.url);
  const body = request.method === "GET" || request.method === "HEAD" ? "" : await request.clone().text();
  if (logFile) appendFileSync(logFile, JSON.stringify({ url: url.toString(), method: request.method, headers: Object.fromEntries(request.headers), body }) + "\n");
  return serve(request, url, body) ?? next(input, init);
};
