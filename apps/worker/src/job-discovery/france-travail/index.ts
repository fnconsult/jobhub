/**
 * France Travail: searching its Offres d'emploi API for postings matching a
 * Profile's Search Criteria, by its structured filters (ROME job codes, area,
 * contract type, NAF divisions, ROME professional domains) rather than free text, with each offer's creation date as its
 * Posting date.
 *
 *   const franceTravail = franceTravailFromEnv(process.env); // null: not configured, Job discovery goes without it
 *   const result = await franceTravail.search(criteria, { max: 30, now, location: "Lyon" });
 *   // { ok: true, offers: [{ url, details }], calls } | { ok: false, reason: "refused" | "failed", detail, calls }
 *
 * Runs only with FRANCE_TRAVAIL_CLIENT_ID and FRANCE_TRAVAIL_CLIENT_SECRET set.
 * Access may be withdrawn at any time (it was in 2026, #119): a search never
 * throws, and a refusal (401, 403, 404, 410, or credentials the token endpoint
 * turns down, or Offres d'emploi not granted: `invalid_scope`) or any other failure is an outcome Job discovery counts and goes
 * on without. `calls` is how many HTTP calls the search made (a token, when the
 * one kept has expired, and the search), within France Travail's 10 calls a second.
 * What the API looks like is unverified and kept in ./api.ts.
 */
import { createFranceTravailTokens, type JobOfferDetails, type SearchCriteria } from "@jobhub/shared";
import { readOffers, SEARCH_URL, searchParams } from "./api";

export interface FranceTravailOffer {
  /** The offer's public page at France Travail. */
  url: string;
  /** The posting, its Posting date (`postedAt`) the offer's creation date. */
  details: JobOfferDetails;
}

export type FranceTravailSearch =
  | { ok: true; offers: FranceTravailOffer[]; calls: number }
  /** `refused`: France Travail turned us away (access withdrawn or not granted); `failed`: anything else went wrong. */
  | { ok: false; reason: "refused" | "failed"; detail: string; calls: number };

export interface FranceTravail {
  /**
   * France Travail's first `max` offers (at most 150) for the Search Criteria near `location` (one of
   * theirs, the first by default), created in the last 30 days at `now`. Never throws.
   */
  search(criteria: SearchCriteria, options: { max: number; now: Date; location?: string }): Promise<FranceTravailSearch>;
}

export interface FranceTravailOptions {
  clientId: string;
  clientSecret: string;
  /** Default: the global fetch. */
  fetch?: typeof globalThis.fetch;
  /** Default: 15 s per call. */
  timeoutMs?: number;
}

/** Statuses by which France Travail refuses us rather than fails. */
const REFUSED = new Set([401, 403, 404, 410]);

class Refused extends Error {}

export function createFranceTravail(options: FranceTravailOptions): FranceTravail {
  const fetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  /** Offres d'emploi's own token, asked with its scopes alone (#400), kept across searches until a minute before it expires. */
  const tokens = createFranceTravailTokens({ clientId: options.clientId, clientSecret: options.clientSecret, fetch, timeoutMs });

  return {
    async search(criteria, { max, now, location }) {
      let calls = 0;
      try {
        const token = await tokens.token("offres_emploi", now);
        calls += token.calls;
        // An unknown client or Offres d'emploi not granted (invalid_scope) is a refusal; anything else a failure.
        if (!token.ok) throw token.reason === "failed" ? new Error(token.detail) : new Refused(token.detail);
        calls++;
        const answer = await fetch(`${SEARCH_URL}?${searchParams(criteria, location === undefined ? { max, now } : { max, now, location })}`, {
          headers: { authorization: `Bearer ${token.value}`, accept: "application/json" },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (answer.status === 204) return { ok: true, offers: [], calls };
        if (REFUSED.has(answer.status)) {
          if (answer.status === 401) tokens.forget("offres_emploi");
          throw new Refused(`search refused (${answer.status})`);
        }
        if (!answer.ok) throw new Error(`search answered ${answer.status}`);
        return { ok: true, offers: readOffers(await answer.json()), calls };
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return { ok: false, reason: error instanceof Refused ? "refused" : "failed", detail, calls };
      }
    },
  };
}

/** France Travail from FRANCE_TRAVAIL_CLIENT_ID and FRANCE_TRAVAIL_CLIENT_SECRET, or null unless both are set. */
export function franceTravailFromEnv(
  env: Record<string, string | undefined>,
  options: Omit<FranceTravailOptions, "clientId" | "clientSecret"> = {},
): FranceTravail | null {
  const clientId = env.FRANCE_TRAVAIL_CLIENT_ID?.trim();
  const clientSecret = env.FRANCE_TRAVAIL_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? createFranceTravail({ ...options, clientId, clientSecret }) : null;
}
