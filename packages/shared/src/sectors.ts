/**
 * Sectors, Subsectors and Domains (#236): what kind of employer and work a Profile's Search
 * Criteria look for, as codes of public nomenclatures, any number of each (none: no preference).
 *
 *   Sector     a section of INSEE's NAF rév. 2 ("C": Industrie manufacturière), A to U
 *   Subsector  one of its divisions ("29": Industrie automobile), two digits
 *   Domain     a ROME 4.0 professional domain of France Travail ("M13": Direction d'entreprise)
 *
 * The codes, and which Sector each Subsector belongs to, are fixed here: they are what Search
 * Criteria accept and what France Travail is searched by. Their labels are reference data, fetched
 * from INSEE and France Travail and cached (an IndustryReference): never written into the code.
 * NAF rév. 2 is in force until the end of 2026; NAF 2025 replaces it from January 2027.
 */

/** NAF rév. 2: each section and its divisions, in the nomenclature's order. */
const NAF_REV2: Readonly<Record<string, readonly string[]>> = {
  A: ["01", "02", "03"],
  B: ["05", "06", "07", "08", "09"],
  C: ["10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "30", "31", "32", "33"],
  D: ["35"],
  E: ["36", "37", "38", "39"],
  F: ["41", "42", "43"],
  G: ["45", "46", "47"],
  H: ["49", "50", "51", "52", "53"],
  I: ["55", "56"],
  J: ["58", "59", "60", "61", "62", "63"],
  K: ["64", "65", "66"],
  L: ["68"],
  M: ["69", "70", "71", "72", "73", "74", "75"],
  N: ["77", "78", "79", "80", "81", "82"],
  O: ["84"],
  P: ["85"],
  Q: ["86", "87", "88"],
  R: ["90", "91", "92", "93"],
  S: ["94", "95", "96"],
  T: ["97", "98"],
  U: ["99"],
};

/** The Sectors, A to U. */
export const SECTORS: readonly string[] = Object.keys(NAF_REV2);

const SECTOR_OF: ReadonlyMap<string, string> = new Map(SECTORS.flatMap((sector) => NAF_REV2[sector]!.map((subsector) => [subsector, sector] as const)));

/** A ROME 4.0 professional domain: its grand domain's letter, then two digits. */
const DOMAIN = /^[A-Z]\d{2}$/;

export const isSector = (code: string): boolean => Object.hasOwn(NAF_REV2, code);
export const isSubsector = (code: string): boolean => SECTOR_OF.has(code);
export const isDomain = (code: string): boolean => DOMAIN.test(code);

/** The Subsectors of a Sector, in order; none for an unknown one. */
export function subsectorsOf(sector: string): string[] {
  return isSector(sector) ? [...NAF_REV2[sector]!] : [];
}

/** The Sector a Subsector belongs to; none for an unknown one. */
export function sectorOf(subsector: string): string | undefined {
  return SECTOR_OF.get(subsector);
}

/** The Sectors, Subsectors and Domains of Search Criteria. */
export interface IndustryChoices {
  sectors: string[];
  subsectors: string[];
  domains: string[];
}

/**
 * The choices as a Profile keeps them: known codes only, each once, in the nomenclature's order
 * (Domains by code); choosing a Subsector chooses its Sector.
 */
export function industryChoices(chosen: IndustryChoices): IndustryChoices {
  const subsectors = new Set(chosen.subsectors.filter(isSubsector));
  const sectors = new Set([...chosen.sectors.filter(isSector), ...[...subsectors].map((code) => sectorOf(code)!)]);
  return {
    sectors: SECTORS.filter((code) => sectors.has(code)),
    subsectors: [...SECTOR_OF.keys()].filter((code) => subsectors.has(code)),
    domains: [...new Set(chosen.domains.filter(isDomain))].sort(),
  };
}

/** The Subsectors a search filters by: those chosen, and every Subsector of a Sector chosen without one. */
export function searchedSubsectors({ sectors, subsectors }: Pick<IndustryChoices, "sectors" | "subsectors">): string[] {
  const searched = new Set(subsectors);
  for (const sector of sectors) {
    const own = subsectorsOf(sector);
    if (!own.some((code) => searched.has(code))) for (const code of own) searched.add(code);
  }
  return [...SECTOR_OF.keys()].filter((code) => searched.has(code));
}

/** One code of a nomenclature and its label, in French and, where the source has it, in English. */
export interface ReferenceEntry {
  code: string;
  /** A Subsector's Sector; a Domain's grand domain (its letter). */
  parent?: string;
  label: { fr: string; en?: string };
}

/** The labels of the Sectors, Subsectors and Domains, as the reference data holds them, each list in order. */
export interface IndustryReference {
  sectors: ReferenceEntry[];
  subsectors: ReferenceEntry[];
  domains: ReferenceEntry[];
}

export const NO_INDUSTRY_REFERENCE: IndustryReference = { sectors: [], subsectors: [], domains: [] };

/**
 * The labels of the Sectors and Domains chosen, in `language` where the nomenclature has it (French
 * otherwise): each Sector by its most precise choice, the Subsectors chosen in it, or itself when
 * none is. A code the reference data does not name is left out.
 */
export function industryLabels(chosen: IndustryChoices, reference: IndustryReference, language: "fr" | "en"): { sectors: string[]; domains: string[] } {
  const labelled = (entries: ReferenceEntry[]) => {
    const labels = new Map(entries.map((entry) => [entry.code, (language === "en" ? entry.label.en : undefined) ?? entry.label.fr]));
    return (code: string) => labels.get(code);
  };
  const [sector, subsector, domain] = [labelled(reference.sectors), labelled(reference.subsectors), labelled(reference.domains)];
  const subsectors = new Set(chosen.subsectors);
  const sectors = chosen.sectors.flatMap((code) => {
    const own = subsectorsOf(code).filter((each) => subsectors.has(each));
    return own.length > 0 ? own.map(subsector) : [sector(code)];
  });
  return {
    sectors: sectors.filter((label): label is string => label !== undefined),
    domains: chosen.domains.map(domain).filter((label): label is string => label !== undefined),
  };
}
