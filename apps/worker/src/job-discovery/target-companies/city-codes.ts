/**
 * The INSEE code of the commune a Search Criteria place names, from geo.api.gouv.fr (public, no
 * key, in the EU): La Bonne Boite searches a radius around a commune by that code (#406).
 *
 *   await createCityCodes({ fetch }).cityCode("Lyon (69)"); // "69123"; null: not a commune, or no answer
 *
 * Only the place's name (or postcode) is sent. A département or région is no commune: La Bonne
 * Boite then reads the place itself. Answers are kept for the worker's life, by place.
 */
import { locationKey } from "@jobhub/shared";

export const GEO_API_URL = "https://geo.api.gouv.fr/communes";

export interface CityCodes {
  /** The INSEE code of the most populated commune `location` names, or null. Never throws. */
  cityCode(location: string): Promise<string | null>;
}

export function createCityCodes(options: { fetch?: typeof globalThis.fetch; timeoutMs?: number } = {}): CityCodes {
  const fetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const known = new Map<string, Promise<string | null>>();

  async function ask(location: string): Promise<string | null> {
    const postcode = /\b\d{5}\b/.exec(location)?.[0];
    // "Lyon (69)": the département in brackets is no part of the name.
    const name = location.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
    if (!postcode && !name) return null;
    const params = new URLSearchParams(postcode ? { codePostal: postcode } : { nom: name });
    params.set("boost", "population");
    params.set("fields", "code,nom");
    params.set("limit", "1");
    try {
      const answer = await fetch(`${GEO_API_URL}?${params}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
      if (!answer.ok) return null;
      const communes: unknown = await answer.json();
      const code = Array.isArray(communes) ? (communes[0] as { code?: unknown } | undefined)?.code : undefined;
      return typeof code === "string" && /^(\d{5}|2[AB]\d{3})$/.test(code) ? code : null;
    } catch {
      return null;
    }
  }

  return {
    cityCode(location) {
      const key = locationKey(location);
      let code = known.get(key);
      if (!code) {
        code = ask(location);
        known.set(key, code);
        // An answer missing for want of the API is asked again next time.
        void code.then((found) => found ?? known.delete(key));
      }
      return code;
    },
  };
}
