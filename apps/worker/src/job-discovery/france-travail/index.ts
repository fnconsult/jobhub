/**
 * France Travail: searching its Offres d'emploi API for postings matching a
 * Profile's Search Criteria, by its structured filters (ROME job codes, area,
 * contract type) rather than free text, with each offer's creation date as its
 * Posting date.
 *
 *   const franceTravail = franceTravailFromEnv(process.env); // null: not configured, Job discovery goes without it
 *   const result = await franceTravail.search(criteria, { max: 30, now });
 *   // { ok: true, offers: [{ url, details }], calls } | { ok: false, reason: "refused" | "failed", detail, calls }
 *
 * Runs only with FRANCE_TRAVAIL_CLIENT_ID and FRANCE_TRAVAIL_CLIENT_SECRET set.
 * Access may be withdrawn at any time (it was in 2026, #119): a search never
 * throws, and a refusal (401, 403, 404, 410, or credentials the token endpoint
 * turns down) or any other failure is an outcome Job discovery counts and goes
 * on without. `calls` is how many HTTP calls the search made (a token, when the
 * one kept has expired, and the search), within France Travail's 10 calls a second.
 * What the API looks like is unverified and kept in ./api.ts.
 */
import type { JobOfferDetails, SearchCriteria } from "@jobhub/shared";
import { readOffers, SCOPE, SEARCH_URL, searchParams, TOKEN_URL } from "./api";

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
  /** France Travail's first `max` offers (at most 150) for the Search Criteria, created in the last 30 days at `now`. Never throws. */
  search(criteria: SearchCriteria, options: { max: number; now: Date }): Promise<FranceTravailSearch>;
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
  /** The access token, kept across searches until a minute before it expires. */
  let token: { value: string; expiresAt: number } | null = null;

  return {
    async search(criteria, { max, now }) {
      let calls = 0;
      const call = (url: string, init: RequestInit = {}) => {
        calls++;
        return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      };
      try {
        if (!token || token.expiresAt <= now.getTime()) {
          const answer = await call(TOKEN_URL, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
            body: new URLSearchParams({ grant_type: "client_credentials", client_id: options.clientId, client_secret: options.clientSecret, scope: SCOPE }),
          });
          if ([400, 401, 403].includes(answer.status)) throw new Refused(`token refused (${answer.status})`);
          if (!answer.ok) throw new Error(`token answered ${answer.status}`);
          const { access_token: value, expires_in: expiresIn } = (await answer.json()) as { access_token?: unknown; expires_in?: unknown };
          if (typeof value !== "string" || !value) throw new Error("token answer without access_token");
          const seconds = typeof expiresIn === "number" && expiresIn > 0 ? expiresIn : 0;
          token = { value, expiresAt: now.getTime() + Math.max(seconds - 60, 0) * 1000 };
        }
        const answer = await call(`${SEARCH_URL}?${searchParams(criteria, { max, now })}`, {
          headers: { authorization: `Bearer ${token.value}`, accept: "application/json" },
        });
        if (answer.status === 204) return { ok: true, offers: [], calls };
        if (REFUSED.has(answer.status)) {
          if (answer.status === 401) token = null;
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
