/**
 * The country a Job Offer's location names, as an ISO 3166-1 alpha-2 code, read
 * from the free text job boards give ("Paris, France", "London, UK",
 * "Issy-les-Moulineaux (92)"). Undefined when no country can be read: a town
 * alone ("Issy-les-Moulineaux") or "Télétravail" names none.
 */

/** Country names are matched in these languages, as job boards in Europe write them. */
const LANGUAGES = ["en", "fr", "de", "es", "it", "nl", "pt"];
/** Codes that are not countries (European Union, United Nations, unknown, pseudo-regions). */
const NOT_COUNTRIES = /^(EU|EZ|UN|ZZ|AA|Q[M-Z]|X[A-JL-Z])$/;
/** Also a US state: "Atlanta, Georgia" is not in the country. */
const AMBIGUOUS = new Set(["georgia"]);
/** Usual names the region names in `LANGUAGES` do not give. */
const ALIASES: Record<string, string> = {
  uk: "GB",
  "u k": "GB",
  "great britain": "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  "northern ireland": "GB",
  angleterre: "GB",
  ecosse: "GB",
  "grande bretagne": "GB",
  us: "US",
  usa: "US",
  "u s": "US",
  "u s a": "US",
  "united states of america": "US",
  holland: "NL",
  hollande: "NL",
  "czech republic": "CZ",
  "republique tcheque": "CZ",
};
/** A French département in brackets, as French job boards write it: "Paris (75)", "Saint-Denis (974)". */
const FRENCH_DEPARTEMENT = /\((?:0[1-9]|[1-8]\d|9[0-5]|2[AB]|97[1-6])\)/i;

const normalized = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

let countries: Map<string, string> | undefined;

/** Every country's name in `LANGUAGES`, normalized, to its code. Built once, on first use. */
function countryNames(): Map<string, string> {
  if (countries) return countries;
  countries = new Map(Object.entries(ALIASES));
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (const language of LANGUAGES) {
    const names = new Intl.DisplayNames([language], { type: "region", fallback: "none" });
    for (const first of letters) {
      for (const second of letters) {
        const code = first + second;
        // Retired codes (DD, YU, SU...) are named after the country that replaced them.
        if (NOT_COUNTRIES.test(code) || Intl.getCanonicalLocales(`und-${code}`)[0] !== `und-${code}`) continue;
        const name = names.of(code);
        if (!name) continue;
        const key = normalized(name);
        if (!AMBIGUOUS.has(key) && !countries.has(key)) countries.set(key, code);
      }
    }
  }
  return countries;
}

export function countryIn(location: string): string | undefined {
  if (FRENCH_DEPARTEMENT.test(location)) return "FR";
  const names = countryNames();
  // The country usually comes last: "Paris, Île-de-France, France".
  const parts = [location, ...location.split(/[,;/|()–—]|\s-\s/).reverse()];
  for (const part of parts) {
    const code = names.get(normalized(part));
    if (code) return code;
  }
  return undefined;
}
