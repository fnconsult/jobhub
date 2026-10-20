/**
 * Place suggestions for the Search Criteria's Locations (#235), from geo.api.gouv.fr: the French
 * state's administrative divisions (communes, départements, régions), public, no key, in the EU
 * (ADR-0007). See docs/research/issue-235.md.
 *
 *   createGeoApiPlaces({ externalApis }).suggest("lyo")   [{ name: "Lyon (69)", kind: "commune" }, ...]
 *
 * A suggestion is only a name to save as the place's text: Locations stay strings (ADR-0025).
 * The API is asked nothing under MIN_PLACE_QUERY_LENGTH characters; it never fails the Candidate:
 * whatever part of it cannot answer adds no suggestion (Enter still adds the place as typed).
 * Answers are kept a short while, by query without case or accents; each call is recorded as
 * `geo-api-gouv`'s (Tools), never with its query.
 */
import { locationKey, recordingFetch, type ExternalApiLog } from "@jobhub/shared";

export type PlaceKind = "commune" | "departement" | "region";

/** A place to suggest: its display name, e.g. "Lyon (69)", "Rhône", "Île-de-France", and what kind it is. */
export interface PlaceSuggestion {
  name: string;
  kind: PlaceKind;
}

export interface PlaceSuggestions {
  /** The places whose name starts like `query`: communes (most populated first), then départements, then régions. */
  suggest(query: string): Promise<PlaceSuggestion[]>;
}

/** No suggestion is asked for under this many characters. */
export const MIN_PLACE_QUERY_LENGTH = 3;
/** How many places are suggested at most. */
export const MAX_PLACE_SUGGESTIONS = 8;
/** At most this many communes, to leave room for the départements and régions. */
const MAX_COMMUNES = 5;
/** The longest query passed on: a place name, not a text. */
const MAX_QUERY_LENGTH = 100;
/** How many queries the cache holds at most. */
const CACHE_SIZE = 500;

export interface GeoApiPlacesOptions {
  fetch?: typeof globalThis.fetch;
  /** Where each call is recorded (Tools, AI Usage's external APIs). Default: nowhere. */
  externalApis?: ExternalApiLog;
  /** Default https://geo.api.gouv.fr */
  baseUrl?: string;
  /** Per call. Default 3 seconds. */
  timeoutMs?: number;
  /** How long an answer is kept. Default 10 minutes (the API says one hour). */
  cacheTtlMs?: number;
  now?: () => Date;
}

type ApiPlace = { nom?: unknown; codeDepartement?: unknown };

export function createGeoApiPlaces(options: GeoApiPlacesOptions = {}): PlaceSuggestions {
  const plainFetch = options.fetch ?? globalThis.fetch;
  // A free public API.
  const fetch = options.externalApis ? recordingFetch(plainFetch, options.externalApis, { provider: "geo-api-gouv", costEur: () => 0 }) : plainFetch;
  const baseUrl = options.baseUrl ?? "https://geo.api.gouv.fr";
  const ttl = options.cacheTtlMs ?? 600_000;
  const now = options.now ?? (() => new Date());
  const cache = new Map<string, { at: number; places: PlaceSuggestion[] }>();

  /** The places at `path` named like `query`; null when the API did not answer them. */
  async function ask(path: string, query: string, params: Record<string, string>): Promise<ApiPlace[] | null> {
    const url = new URL(path, baseUrl);
    url.searchParams.set("nom", query);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
    try {
      const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(options.timeoutMs ?? 3000) });
      if (!response.ok) return null;
      const body: unknown = await response.json();
      return Array.isArray(body) ? body : null;
    } catch {
      return null;
    }
  }

  return {
    async suggest(raw) {
      const query = raw.trim().slice(0, MAX_QUERY_LENGTH);
      if (query.length < MIN_PLACE_QUERY_LENGTH) return [];
      const key = locationKey(query);
      const kept = cache.get(key);
      if (kept && now().getTime() - kept.at < ttl) return kept.places;

      const [communes, departements, regions] = await Promise.all([
        ask("/communes", query, { fields: "nom,codeDepartement", boost: "population", limit: String(MAX_COMMUNES) }),
        ask("/departements", query, { fields: "nom" }),
        ask("/regions", query, { fields: "nom" }),
      ]);
      const named = (places: ApiPlace[] | null) => (places ?? []).filter((place): place is { nom: string; codeDepartement?: unknown } => typeof place?.nom === "string" && place.nom.trim() !== "");
      const found: PlaceSuggestion[] = [
        ...named(communes)
          .map((place) => ({ name: typeof place.codeDepartement === "string" ? `${place.nom} (${place.codeDepartement})` : place.nom, kind: "commune" as const }))
          .filter(unique())
          .slice(0, MAX_COMMUNES),
        ...named(departements).map((place) => ({ name: place.nom, kind: "departement" as const })),
        ...named(regions).map((place) => ({ name: place.nom, kind: "region" as const })),
      ];
      const places = found.filter(unique()).slice(0, MAX_PLACE_SUGGESTIONS);

      if (communes && departements && regions) {
        cache.delete(key);
        cache.set(key, { at: now().getTime(), places });
        if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
      }
      return places;
    },
  };
}

/** A filter keeping each place's name once (without case or accents). */
function unique() {
  const seen = new Set<string>();
  return (place: PlaceSuggestion) => {
    const key = locationKey(place.name);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
}
