/**
 * The countries a people search can be narrowed to (#95), held once as
 * ISO 3166-1 alpha-2 codes. Each provider derives its own form from the code:
 * Lusha takes the code, Apollo the English name (docs/research/issue-95.md).
 * Only countries named here can be searched; a location naming no other one
 * gives no country, and the search is then not narrowed.
 */

/** English name (as Apollo takes it), then the other names a location may give: French, English, local. Accents and case do not matter. */
const COUNTRIES = {
  FR: ["france"],
  BE: ["belgium", "belgique", "belgie", "belgien"],
  CH: ["switzerland", "suisse", "schweiz", "svizzera"],
  LU: ["luxembourg", "luxemburg"],
  MC: ["monaco"],
  DE: ["germany", "allemagne", "deutschland"],
  ES: ["spain", "espagne", "espana"],
  IT: ["italy", "italie", "italia"],
  PT: ["portugal"],
  NL: ["netherlands", "pays bas", "nederland", "holland", "hollande"],
  GB: ["united kingdom", "royaume uni", "uk", "great britain", "grande bretagne", "england", "angleterre", "scotland", "ecosse", "wales", "pays de galles", "northern ireland", "irlande du nord"],
  IE: ["ireland", "irlande"],
  AT: ["austria", "autriche", "osterreich"],
  PL: ["poland", "pologne", "polska"],
  CZ: ["czech republic", "republique tcheque", "tchequie", "czechia"],
  SK: ["slovakia", "slovaquie"],
  HU: ["hungary", "hongrie"],
  RO: ["romania", "roumanie"],
  BG: ["bulgaria", "bulgarie"],
  GR: ["greece", "grece"],
  HR: ["croatia", "croatie"],
  SI: ["slovenia", "slovenie"],
  SE: ["sweden", "suede", "sverige"],
  DK: ["denmark", "danemark"],
  NO: ["norway", "norvege"],
  FI: ["finland", "finlande"],
  EE: ["estonia", "estonie"],
  LV: ["latvia", "lettonie"],
  LT: ["lithuania", "lituanie"],
  MT: ["malta", "malte"],
  CY: ["cyprus", "chypre"],
  US: ["united states", "etats unis", "usa", "united states of america", "etats unis d amerique", "new mexico"],
  CA: ["canada", "quebec"],
  MX: ["mexico", "mexique"],
  BR: ["brazil", "bresil", "brasil"],
  MA: ["morocco", "maroc"],
  TN: ["tunisia", "tunisie"],
  DZ: ["algeria", "algerie"],
  SN: ["senegal"],
  CI: ["cote d ivoire", "ivory coast"],
  AE: ["united arab emirates", "emirats arabes unis", "uae", "dubai", "abu dhabi"],
  IL: ["israel"],
  IN: ["india", "inde"],
  CN: ["china", "chine"],
  JP: ["japan", "japon"],
  SG: ["singapore", "singapour"],
  AU: ["australia", "australie"],
} as const satisfies Record<string, readonly [string, ...string[]]>;

/** A country a people search can be narrowed to: its ISO 3166-1 alpha-2 code ("FR"). */
export type CountryCode = keyof typeof COUNTRIES;

/** The country's English name, lowercase ("united kingdom"), as Apollo's location filters take it. */
export function englishName(country: CountryCode): string {
  return COUNTRIES[country][0];
}

/** Lowercase, without accents, words separated by single spaces and padded with one: " cote d ivoire ". */
const words = (text: string) => ` ${text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;

/**
 * The country a free-text location names ("Londres, Royaume-Uni" is GB), or
 * undefined when it names none of the countries above ("Lyon", "Remote").
 * A city alone never gives a country. When several are named, the last one
 * wins ("Dublin, Ireland"), and the longest name ending there ("Belfast,
 * Northern Ireland" is GB, "Santa Fe, New Mexico" is US).
 */
export function countryIn(location: string): CountryCode | undefined {
  const text = words(location);
  let found: { country: CountryCode; end: number; length: number } | undefined;
  for (const [country, names] of Object.entries(COUNTRIES) as [CountryCode, readonly string[]][]) {
    for (const name of names) {
      const start = text.lastIndexOf(` ${name} `);
      if (start < 0) continue;
      const end = start + name.length;
      if (!found || end > found.end || (end === found.end && name.length > found.length)) found = { country, end, length: name.length };
    }
  }
  return found?.country;
}
