/**
 * What the Sectors, Subsectors and Domains inputs (#236) offer and do, apart from the markup.
 *
 *   industryOptions(reference, "subsectors", ["C"], "fr")  the Subsectors of Sector C, by label
 *   matchingOptions(options, chosen, "auto")               those not chosen whose label holds what is typed
 *   withSectors({ sectors, subsectors }, ["K"])            new Sectors, the Subsectors of the others dropped
 */
import { locationKey, sectorOf, type IndustryReference, type ReferenceEntry } from "@jobhub/shared";

/** The three inputs, in the order a form shows them. */
export const INDUSTRY_FIELDS = ["sectors", "subsectors", "domains"] as const;
export type IndustryField = (typeof INDUSTRY_FIELDS)[number];

/** One choice offered: a code, its label, and for a Subsector the Sector it is in. */
export interface IndustryOption {
  code: string;
  label: string;
  group?: string;
}

const labelOf = (entry: ReferenceEntry, language: string) => (language.startsWith("en") ? entry.label.en : undefined) ?? entry.label.fr;

/**
 * The choices `field` offers, in the nomenclature's order, by their labels in `language` where it has
 * them (French otherwise): every Sector or Domain; for Subsectors, those of the `sectors` chosen only.
 */
export function industryOptions(reference: IndustryReference, field: IndustryField, sectors: readonly string[], language: string): IndustryOption[] {
  if (field !== "subsectors") return reference[field].map((entry) => ({ code: entry.code, label: labelOf(entry, language) }));
  const sectorLabels = new Map(reference.sectors.map((entry) => [entry.code, labelOf(entry, language)]));
  return reference.subsectors
    .filter((entry) => entry.parent !== undefined && sectors.includes(entry.parent))
    .map((entry) => ({ code: entry.code, label: labelOf(entry, language), group: sectorLabels.get(entry.parent!) ?? entry.parent! }));
}

/** The options not `chosen` yet whose label holds every word of `query` (without case or accents), or whose code starts it. */
export function matchingOptions(options: readonly IndustryOption[], chosen: readonly string[], query: string): IndustryOption[] {
  const words = locationKey(query).split(/\s+/).filter(Boolean);
  return options.filter((option) => {
    if (chosen.includes(option.code)) return false;
    if (words.length === 0) return true;
    const label = locationKey(option.label);
    return words.every((word) => label.includes(word)) || option.code.toLowerCase().startsWith(locationKey(query));
  });
}

/** The choices with `sectors` as the Sectors: the Subsectors chosen in a Sector no longer chosen go with it. */
export function withSectors(choices: { sectors: string[]; subsectors: string[] }, sectors: string[]): { sectors: string[]; subsectors: string[] } {
  return { sectors, subsectors: choices.subsectors.filter((code) => sectors.includes(sectorOf(code) ?? "")) };
}
