// Preloaded into the e2e web server (NODE_OPTIONS=--import) to stand in for the
// contact-data providers behind Enriched Contacts (issue #23): the suite runs
// with CONTACT_ENRICHMENT_PROVIDER=apollo, and Apollo's API is answered here;
// a server started with CONTACT_ENRICHMENT_PROVIDER=lusha gets Lusha's v3 API
// (issue #77), and Lusha's account usage answers the Clés connection test, accepting
// e2e-lusha-key and any key starting e2e-lusha-valid- (#208). Nothing reaches the real ones.
//
// Apollo: a search at any company finds two made-up people, Claire Martin (DRH)
// and Hugo Bernard (Responsable recrutement). Claire's details reveal a work
// email; Apollo has none for Hugo.
import { appendFileSync } from "node:fs";

const realFetch = globalThis.fetch;
const API = "https://api.apollo.io/api/v1";
const KEY = "e2e-apollo-key";

const people = [
  { id: "e2e-claire", first_name: "Claire", last_name_obfuscated: "Ma***n", title: "DRH" },
  { id: "e2e-hugo", first_name: "Hugo", last_name_obfuscated: "Be***d", title: "Responsable recrutement" },
];
const details = {
  "e2e-claire": { id: "e2e-claire", name: "Claire Martin", title: "DRH", email: "claire.martin@acme-industrie.example" },
};

// Lusha v3 (https://docs.lusha.com, docs/research/issue-77.md), as strict as the
// real API about the request: a property the schema does not define is refused
// with 400 "property X should not exist" (the bug behind #77), and so is a page
// size outside 10-100; `options.excludeDnc` gets 403, as on a plan without it. Prospecting answers in `results[]`, with `jobTitle` as an
// object, one result Lusha could not give (`error`) and one without an `id`;
// Enrich Contacts reveals Sophie Lambert's email and phones (one flagged
// do-not-call) and nothing for Thomas Moreau. Each request body is appended, one
// JSON line, to E2E_LUSHA_REQUESTS when that is set, so a spec can read what was sent.
const LUSHA = "https://api.lusha.com/v3";
const LUSHA_KEY = "e2e-lusha-key";
const company = { id: "e2e-acme", name: "Acme Industrie", domain: "acme-industrie.example" };
const lushaResults = [
  { id: "e2e-lusha-sophie", firstName: "Sophie", lastName: "Lambert", jobTitle: { title: "DRH", departments: ["Human Resources"], seniority: "Director" }, company, has: ["emails", "phones"] },
  { id: "e2e-lusha-restricted", firstName: "Léa", lastName: "Roux", jobTitle: { title: "DRH" }, company, error: { code: "COMPLIANCE_RESTRICTED", message: "Restricted" } },
  { firstName: "Paul", lastName: "Durand", jobTitle: { title: "Talent Acquisition Manager" }, company },
  { id: "e2e-lusha-thomas", firstName: "Thomas", lastName: "Moreau", jobTitle: { title: "Responsable recrutement", departments: ["Human Resources"], seniority: "Manager" }, company, has: [] },
];
const lushaEnriched = {
  "e2e-lusha-sophie": {
    id: "e2e-lusha-sophie",
    firstName: "Sophie",
    lastName: "Lambert",
    fullName: "Sophie Lambert",
    jobTitle: { title: "DRH", departments: ["Human Resources"], seniority: "Director" },
    location: { country: "France", isEuContact: true },
    company,
    emails: [{ email: "sophie.lambert@acme-industrie.example", type: "work", confidence: "A", updateDate: "2026-09-01" }],
    phones: [
      { number: "+33 4 72 10 20 30", type: "direct", doNotCall: false, updateDate: "2026-09-01" },
      { number: "+33 6 99 99 99 99", type: "mobile", doNotCall: true, updateDate: "2026-09-01" },
    ],
  },
  "e2e-lusha-thomas": {
    id: "e2e-lusha-thomas",
    firstName: "Thomas",
    lastName: "Moreau",
    jobTitle: { title: "Responsable recrutement" },
    company,
    emails: [],
    phones: [],
  },
};
const lushaRefusal = (message) => Response.json({ statusCode: 400, message }, { status: 400 });
const extraProperty = (value, allowed) => Object.keys(value ?? {}).find((key) => !allowed.includes(key));

function answerLusha(url, init) {
  const headers = new Headers(init?.headers);
  if (headers.get("api_key") !== LUSHA_KEY) return Response.json({ statusCode: 401, message: "Unauthorized" }, { status: 401 });
  if ((init?.method ?? "GET").toUpperCase() !== "POST") return Response.json({ statusCode: 404, message: "Not Found" }, { status: 404 });
  let body;
  try {
    body = JSON.parse(init?.body ?? "");
  } catch {
    return lushaRefusal("body must be JSON");
  }
  if (process.env.E2E_LUSHA_REQUESTS) appendFileSync(process.env.E2E_LUSHA_REQUESTS, `${JSON.stringify({ path: url.pathname, body })}\n`);

  if (url.pathname === "/v3/contacts/prospecting") {
    const extra = extraProperty(body, ["pagination", "filters", "options", "tableId"]);
    if (extra) return lushaRefusal(`property ${extra} should not exist`);
    const size = body.pagination?.size;
    if (!Number.isInteger(size) || size < 10 || size > 100) return lushaRefusal("pagination.size must be between 10 and 100");
    if (!body.filters) return lushaRefusal("filters should not be empty");
    const optionExtra = extraProperty(body.options, ["includePartialProfiles", "excludeDnc", "maxContactsPerCompany"]);
    if (optionExtra) return lushaRefusal(`property options.${optionExtra} should not exist`);
    // Like the plan Jobbbox is on (#77): excluding do-not-contact people is not part of it.
    if (body.options && "excludeDnc" in body.options) {
      return Response.json(
        { name: "BadRequest", message: "Exclude DNC is not supported on your current plan. Please contact support or your account manager for assistance.", code: 403, className: "forbidden" },
        { status: 403 },
      );
    }
    return Response.json({
      results: lushaResults,
      pagination: { page: body.pagination.page ?? 0, size, total: lushaResults.length, totalGuaranteed: true },
      billing: { creditsCharged: lushaResults.length, resultsReturned: lushaResults.length },
    });
  }
  if (url.pathname === "/v3/contacts/enrich") {
    const extra = extraProperty(body, ["ids", "reveal", "waterfallEnabled", "tableId"]);
    if (extra) return lushaRefusal(`property ${extra} should not exist`);
    if (!Array.isArray(body.ids) || body.ids.length < 1 || body.ids.length > 100) return lushaRefusal("ids must contain 1 to 100 elements");
    const results = body.ids.map((id) => lushaEnriched[id] ?? { id, error: { code: "NOT_FOUND", message: "Contact not found" } });
    return Response.json({ results, billing: { creditsCharged: 3, resultsReturned: results.length } });
  }
  return Response.json({ statusCode: 404, message: "Not Found" }, { status: 404 });
}

globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.href.startsWith(`${LUSHA}/`)) return answerLusha(url, init);
  // Lusha's account usage, the Clés section's connection test (#208): a key Lusha does not know is
  // refused, echoed back in the answer as some providers do, so the suite can check it is scrubbed.
  if (url.href === "https://api.lusha.com/account/usage") {
    const key = new Headers(init?.headers).get("api_key") ?? "";
    if (key !== LUSHA_KEY && !key.startsWith("e2e-lusha-valid-")) return Response.json({ statusCode: 401, message: `Invalid api_key ${key}` }, { status: 401 });
    return Response.json({ usage: { credits: { used: 0, total: 100 } } });
  }
  // Fantastic.jobs' active-ats, the Clés section's connection test (#243): a search for no job. A key starting
  // e2e-fj-valid- is accepted; any other is refused (401), echoed back in the answer to check it is scrubbed.
  if (url.href.startsWith("https://data.fantastic.jobs/v1/active-ats")) {
    const key = /^Bearer (.*)$/.exec(new Headers(init?.headers).get("authorization") ?? "")?.[1] ?? "";
    if (!key.startsWith("e2e-fj-valid-")) return Response.json({ message: `Invalid API key ${key}` }, { status: 401 });
    return Response.json([], { headers: { "x-api-jobs-this-request": "0" } });
  }
  if (`${url.origin}/api/v1` !== API) return realFetch(input, init);
  const headers = new Headers(init?.headers);
  if (headers.get("x-api-key") !== KEY) return Response.json({ error: "Invalid access credentials." }, { status: 401 });
  if (url.pathname === "/api/v1/mixed_people/api_search") {
    // Each search the server sent, one JSON line of query parameters (name -> values), to E2E_APOLLO_REQUESTS when set (#95).
    if (process.env.E2E_APOLLO_REQUESTS) {
      const query = {};
      for (const [name, value] of url.searchParams) (query[name] ??= []).push(value);
      appendFileSync(process.env.E2E_APOLLO_REQUESTS, `${JSON.stringify({ path: url.pathname, query })}\n`);
    }
    return Response.json({ people, total_entries: people.length });
  }
  if (url.pathname === "/api/v1/people/match") {
    const { id } = JSON.parse(init?.body ?? "{}");
    return Response.json({ person: details[id] ?? null });
  }
  return Response.json({ error: "not found" }, { status: 404 });
};
