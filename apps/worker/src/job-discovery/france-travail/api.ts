/**
 * What France Travail's Offres d'emploi v2 API looks like: where to ask, what
 * its search takes, and how to read its offers.
 *
 * UNVERIFIED: the official documentation is a JavaScript page that could not be
 * read and access is withdrawn until granted (#119, docs/research/issue-120.md).
 * Everything here comes from third-party clients, so it is kept in this one
 * module: check it against the official OpenAPI file or a live answer once
 * access is granted, and replace fixtures/france-travail/*.synthetic.json with
 * captured answers.
 */
import { MAX_POSTING_AGE_DAYS, type ContractType, type JobOfferDetails, type SalaryRange, type SearchCriteria } from "@jobhub/shared";
import { romeCodesFor } from "./rome";

/** OAuth2 client-credentials token endpoint, in the "/partenaire" realm. */
export const TOKEN_URL = "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire";
/** The scopes the Offres d'emploi v2 API asks for. */
export const SCOPE = "api_offresdemploiv2 o2dsoffre";
export const SEARCH_URL = "https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search";
/** The most offers one search answer gives (its `range` spans at most 150). */
export const MAX_RANGE = 150;

/** The public page of an offer, which a Candidate can open and the source re-check can read. */
const offerPage = (id: string) => `https://candidat.francetravail.fr/offres/recherche/detail/${encodeURIComponent(id)}`;

const CONTRACT_CODES: Record<ContractType, string> = { cdi: "CDI", cdd: "CDD", interim: "MIS", freelance: "LIB" };
const CONTRACT_TYPES = Object.fromEntries(Object.entries(CONTRACT_CODES).map(([type, code]) => [code, type])) as Record<string, ContractType>;

/** Words of a text: lower case, no accents, split on anything not a letter or digit. */
const words = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** Large French cities and business districts, by name as `words` leaves it, and their département. */
const CITY_DEPARTEMENTS: Record<string, string> = {
  paris: "75",
  "la defense": "92",
  nanterre: "92",
  "boulogne billancourt": "92",
  versailles: "78",
  lyon: "69",
  villeurbanne: "69",
  marseille: "13",
  "aix en provence": "13",
  toulouse: "31",
  nice: "06",
  nantes: "44",
  montpellier: "34",
  strasbourg: "67",
  bordeaux: "33",
  lille: "59",
  rennes: "35",
  reims: "51",
  toulon: "83",
  grenoble: "38",
  dijon: "21",
  angers: "49",
  nimes: "30",
  "clermont ferrand": "63",
  "saint etienne": "42",
  "le mans": "72",
  "le havre": "76",
  rouen: "76",
  brest: "29",
  tours: "37",
  amiens: "80",
  limoges: "87",
  annecy: "74",
  metz: "57",
  nancy: "54",
  mulhouse: "68",
  besancon: "25",
  perpignan: "66",
  orleans: "45",
  caen: "14",
};

/** French regions by name as `words` leaves it, and their INSEE code. */
const REGIONS: Record<string, string> = {
  "ile de france": "11",
  idf: "11",
  "centre val de loire": "24",
  "bourgogne franche comte": "27",
  normandie: "28",
  "hauts de france": "32",
  "grand est": "44",
  "pays de la loire": "52",
  bretagne: "53",
  "nouvelle aquitaine": "75",
  occitanie: "76",
  "auvergne rhone alpes": "84",
  "provence alpes cote d azur": "93",
  paca: "93",
  corse: "94",
};

/** Words left out of the keywords searched when the title names no ROME job. */
const NOT_KEYWORDS = new Set(["de", "du", "des", "la", "le", "les", "et", "en", "d", "l", "a", "au", "aux", "h", "f", "of", "and", "the"]);

/** The département of the first French postcode in a text: its first two digits, three overseas (97x). */
function postcodeDepartement(text: string): string | undefined {
  const match = /\b(?:(97\d)\d{2}|(\d{2})\d{3})\b/.exec(text);
  const departement = match?.[1] ?? match?.[2];
  // Corsica's postcodes (20xxx) do not tell 2A from 2B.
  return departement === "20" ? undefined : departement;
}

/** Where the Search Criteria location is, as France Travail filters by it; nothing for a place it does not know (all of France). */
function area(location: string): Record<string, string> {
  const text = ` ${words(location).join(" ")} `;
  const departement =
    Object.entries(CITY_DEPARTEMENTS).find(([city]) => text.includes(` ${city} `))?.[1] ??
    // A postcode ("69003", "97400"), or a département in brackets ("Écully (69)").
    postcodeDepartement(location) ??
    /\(\s*(\d{2}|2[ab]|97\d)\s*\)/i.exec(location)?.[1]?.toUpperCase();
  if (departement) return { departement };
  const region = Object.entries(REGIONS).find(([name]) => text.includes(` ${name} `))?.[1];
  return region ? { region } : {};
}

/** France Travail's dates: an ISO instant to the second. */
const isoSeconds = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, "Z");

/**
 * The search for `criteria` near `location`, one of its locations (France Travail
 * filters by one area at a time, so Job discovery searches each location in turn,
 * ADR-0025): by the ROME codes of its title, else by the title's keywords; in that
 * area when France Travail knows it, and in any of its contract types; created in
 * the last MAX_POSTING_AGE_DAYS days; the first `max` offers (at most MAX_RANGE).
 */
export function searchParams(
  criteria: SearchCriteria,
  { max, now, location = criteria.locations[0] ?? "" }: { max: number; now: Date; location?: string },
): URLSearchParams {
  const params = new URLSearchParams();
  const codes = romeCodesFor(criteria.targetRole);
  if (codes.length > 0) params.set("codeROME", codes.join(","));
  else params.set("motsCles", words(criteria.targetRole).filter((word) => !NOT_KEYWORDS.has(word)).join(","));
  for (const [name, value] of Object.entries(area(location))) params.set(name, value);
  // Several contract types are one comma-separated filter, any of which will do.
  if (criteria.contractTypes.length > 0) params.set("typeContrat", [...new Set(criteria.contractTypes.map((type) => CONTRACT_CODES[type]))].join(","));
  params.set("minCreationDate", isoSeconds(new Date(now.getTime() - MAX_POSTING_AGE_DAYS * 24 * 60 * 60 * 1000)));
  params.set("maxCreationDate", isoSeconds(now));
  params.set("range", `0-${Math.min(Math.max(max, 1), MAX_RANGE) - 1}`);
  return params;
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value.trim() : undefined);

/** A salary stated as "Annuel de 110000.00 Euros à 130000.00 Euros" or "Mensuel de 5000.00 Euros sur 12 mois", as a gross annual range. */
function salary(text: string | undefined): SalaryRange | undefined {
  const match = /^(annuel|mensuel)\s+de\s+([\d\s.,]+)\s*euros?(?:\s+à\s+([\d\s.,]+)\s*euros?)?/i.exec(text ?? "");
  if (!match) return undefined;
  const factor = match[1]?.toLowerCase() === "annuel" ? 1 : 12;
  const amount = (raw: string | undefined) => {
    const value = raw ? Number(raw.replace(/\s/g, "").replace(",", ".")) : NaN;
    return Number.isFinite(value) && value > 0 ? Math.round(value * factor) : undefined;
  };
  const range: SalaryRange = {};
  const [min, max] = [amount(match[2]), amount(match[3])];
  if (min !== undefined) range.min = min;
  if (max !== undefined) range.max = max;
  return min === undefined && max === undefined ? undefined : range;
}

/** One offer of a search answer as a posting at its France Travail page, or null without an id, a title or a description. */
function readOffer(offer: unknown): { url: string; details: JobOfferDetails } | null {
  if (!isObject(offer)) return null;
  const [id, title, content] = [str(offer.id), str(offer.intitule), str(offer.description)];
  if (!id || !title || !content) return null;
  const details: JobOfferDetails = { title, content };
  const employer = isObject(offer.entreprise) ? str(offer.entreprise.nom) : undefined;
  if (employer) details.employer = employer;
  const location = isObject(offer.lieuTravail) ? str(offer.lieuTravail.libelle) : undefined;
  if (location) details.location = location;
  const contractType = CONTRACT_TYPES[str(offer.typeContrat)?.toUpperCase() ?? ""];
  if (contractType) details.contractType = contractType;
  const pay = salary(isObject(offer.salaire) ? str(offer.salaire.libelle) : undefined);
  if (pay) details.salary = pay;
  const skills = (Array.isArray(offer.competences) ? offer.competences : []).map((skill) => (isObject(skill) ? str(skill.libelle) : undefined)).filter((skill) => skill !== undefined);
  if (skills.length > 0) details.skills = skills;
  const years = /^(\d+)\s*an/i.exec(str(offer.experienceLibelle) ?? "")?.[1];
  if (years) details.requiredExperienceYears = Number(years);
  // The creation date, not `dateActualisation`, which moves when the offer is updated (#116).
  const created = Date.parse(str(offer.dateCreation) ?? "");
  if (Number.isFinite(created)) details.postedAt = new Date(created);
  return { url: offerPage(id), details };
}

/** The offers of a search answer that make postings, in its order. */
export function readOffers(answer: unknown): { url: string; details: JobOfferDetails }[] {
  const results = isObject(answer) && Array.isArray(answer.resultats) ? answer.resultats : [];
  return results.map(readOffer).filter((offer) => offer !== null);
}
