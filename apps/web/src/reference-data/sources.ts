/**
 * Where the Sectors', Subsectors' and Domains' labels come from (#236, docs/research/issue-236.md),
 * both public, without a key:
 *
 *   fetchNaf(fetch)          NAF rév. 2 sections and divisions, French and English, from INSEE's SPARQL endpoint
 *   fetchRomeDomains(fetch)  ROME 4.0 professional domains, French only, from France Travail's open data archive
 *
 * Each throws when its source does not answer what it should, so the labels kept stay as they were.
 */
import type { ReferenceEntry } from "@jobhub/shared";
import { zipEntry } from "./unzip";

/** INSEE's public SPARQL endpoint, holding its nomenclatures (codes.insee.fr). */
export const NAF_SPARQL_URL = "https://rdf.insee.fr/sparql";
/** The whole ROME as open data (Licence Ouverte): a zip of JSON files, refreshed with each ROME version. */
export const ROME_OPEN_DATA_URL = "https://api.francetravail.fr/api-nomenclatureemploi/v1/open-data/json";

/** Per call: the ROME archive weighs about 5 MB. */
const TIMEOUT_MS = 60_000;

/** NAF rév. 2's sections and divisions, each with its French and English label and a division's section. */
const NAF_QUERY = `PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
SELECT ?level ?code ?parent ?fr ?en WHERE {
  ?s skos:notation ?code ; skos:prefLabel ?fr .
  FILTER(lang(?fr) = "fr")
  OPTIONAL { ?s skos:prefLabel ?en . FILTER(lang(?en) = "en") }
  FILTER(REGEX(STR(?s), "^http://id.insee.fr/codes/nafr2/(section|division)/"))
  BIND(REPLACE(STR(?s), "^http://id.insee.fr/codes/nafr2/([a-z]+)/.*$", "$1") AS ?level)
  OPTIONAL { ?s skos:broader ?p . ?p skos:notation ?parent . }
}`;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value.trim() : undefined);

async function download(fetch: typeof globalThis.fetch, url: string, accept: string): Promise<Response> {
  const response = await fetch(url, { headers: { accept }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}`);
  return response;
}

/** NAF rév. 2: its Sectors (A to U) and Subsectors (01 to 99), each list in code order. */
export async function fetchNaf(fetch: typeof globalThis.fetch): Promise<{ sectors: ReferenceEntry[]; subsectors: ReferenceEntry[] }> {
  const url = `${NAF_SPARQL_URL}?${new URLSearchParams({ query: NAF_QUERY })}`;
  const answer: unknown = await (await download(fetch, url, "application/sparql-results+json")).json();
  const bindings = isObject(answer) && isObject(answer.results) && Array.isArray(answer.results.bindings) ? answer.results.bindings : [];
  const value = (binding: Json, name: string) => (isObject(binding[name]) ? text(binding[name].value) : undefined);
  const sectors = new Map<string, ReferenceEntry>();
  const subsectors = new Map<string, ReferenceEntry>();
  for (const binding of bindings.filter(isObject)) {
    const [level, code, fr, en, parent] = ["level", "code", "fr", "en", "parent"].map((name) => value(binding, name));
    if (!code || !fr) continue;
    const label = en ? { fr, en } : { fr };
    if (level === "section" && /^[A-Z]$/.test(code)) sectors.set(code, { code, label });
    else if (level === "division" && /^\d{2}$/.test(code) && parent) subsectors.set(code, { code, parent, label });
  }
  if (sectors.size === 0) throw new Error("INSEE answered no Sector");
  const inOrder = (entries: Map<string, ReferenceEntry>) => [...entries.values()].sort((a, b) => a.code.localeCompare(b.code));
  return { sectors: inOrder(sectors), subsectors: inOrder(subsectors).filter((entry) => sectors.has(entry.parent!)) };
}

/** A file of the ROME archive: UTF-8 when it reads as such, else Latin-1, as France Travail writes them. */
function decoded(bytes: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return bytes.toString("latin1");
  }
}

/** ROME 4.0's professional domains ("M13"), in the main tree's order, each under its grand domain ("M"); and the ROME version. */
export async function fetchRomeDomains(fetch: typeof globalThis.fetch): Promise<{ domains: ReferenceEntry[]; version?: string }> {
  const archive = new Uint8Array(await (await download(fetch, ROME_OPEN_DATA_URL, "application/zip, application/octet-stream")).arrayBuffer());
  const tree = zipEntry(archive, (name) => /arborescence_principale[^/]*\.json$/.test(name));
  if (!tree) throw new Error("the ROME archive holds no main tree");
  const parsed: unknown = JSON.parse(decoded(tree));
  const grandDomains = isObject(parsed) && Array.isArray(parsed.arbo_principale) ? parsed.arbo_principale.filter(isObject) : [];
  const domains: ReferenceEntry[] = [];
  for (const grand of grandDomains) {
    const parent = text(grand.code_metier);
    for (const domain of (Array.isArray(grand.liste_domaine_prof) ? grand.liste_domaine_prof : []).filter(isObject)) {
      const [code, fr] = [text(domain.code_metier), text(domain.libelle)];
      if (code && fr && /^[A-Z]\d{2}$/.test(code)) domains.push(parent ? { code, parent, label: { fr } } : { code, label: { fr } });
    }
  }
  if (domains.length === 0) throw new Error("the ROME main tree holds no professional domain");
  const versionFile = zipEntry(archive, (name) => /(^|\/)version\.txt$/.test(name));
  const version = versionFile ? /version\s*:\s*(\d+)/i.exec(decoded(versionFile))?.[1] : undefined;
  return version ? { domains, version: `ROME 4.0 v${version}` } : { domains };
}
