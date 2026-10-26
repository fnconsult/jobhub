/**
 * France Travail's La Bonne Boite v2 (companies likely to hire, by job and area) and ROMEO v2
 * (a job title's ROME codes), for the Target Companies of Job discovery (#406):
 *
 *   const { laBonneBoite, romeo } = createFranceTravailApis({ clientId, clientSecret, fetch });
 *   await laBonneBoite.search({ job: { by: "table", codes: ["M1205"] }, area: { citycode: "69123", distanceKm: 30 } }, now);
 *   // { ok: true, companies: [{ siret, name, hiringScore, city?, activity? }], calls } | { ok: false, reason: "refused" | "failed", detail, calls }
 *   await romeo.predict("Responsable bureau d'études", now); // { ok: true, codes: ["H1206"], calls } | { ok: false, ... }
 *
 * Each API asks its own token, with its own scopes only (ADR-0044). Only a job (ROME codes or a
 * title) and an area are ever sent (ADR-0007). Both are free, open-licence APIs.
 *
 * Pace: France Travail gives La Bonne Boite 2 calls a second (data.gouv.fr); the calls of both APIs
 * keep at least 500 ms apart. The answer's `X-Ratelimit-Remaining-Clientidlimiter` at 0 makes the
 * next call wait a second; a 429 is waited out for its `Retry-After` (at most 10 s) and asked once
 * more. Never throws: `refused` is France Travail turning the client away (token refused,
 * 401, 403), `failed` anything else (network, 5xx, still rate limited).
 *
 * UNVERIFIED (docs/research/france-travail-apis.md §3–4, issue-406.md): the array parameters'
 * form (`rome` repeated), the default page size, ROMEO's answer shape. Read defensively here.
 */
import { createFranceTravailTokens, type FranceTravailApi, type FranceTravailTokens } from "@jobhub/shared";
import { realClock, type Clock } from "@jobhub/shared/page-reading";
import type { RomePrediction, RomePredictor, RomeResolution } from "./rome-resolution";

export const LA_BONNE_BOITE_URL = "https://api.francetravail.io/partenaire/labonneboite/v2/recherche";
export const ROMEO_URL = "https://api.francetravail.io/partenaire/romeo/v2/predictionMetiers";

/** Companies asked for per search: a month of visits at 5 a week. */
export const LA_BONNE_BOITE_PAGE_SIZE = 20;
/** ROMEO's own threshold: a code scored lower is not a sure enough match. */
export const ROMEO_MIN_SCORE = 0.7;

/** At least this long between two calls: 2 a second. */
const MIN_INTERVAL_MS = 500;
/** How long to wait when the rate-limit headers say no call is left this second. */
const EMPTY_BUCKET_WAIT_MS = 1000;
/** The longest `Retry-After` waited out; longer, the call fails. */
const MAX_RETRY_AFTER_MS = 10_000;

/** A company La Bonne Boite gives as likely to hire: one establishment (SIRET), with its hiring potential (0–100). */
export interface LaBonneBoiteCompany {
  siret: string;
  name: string;
  hiringScore: number;
  city?: string;
  /** Its NAF activity, as La Bonne Boite labels it. */
  activity?: string;
}

/** Where to look: around a commune (its INSEE code), or a place La Bonne Boite reads itself. */
export type LaBonneBoiteArea = { citycode: string; distanceKm: number } | { location: string };

export type LaBonneBoiteSearch =
  | { ok: true; companies: LaBonneBoiteCompany[]; calls: number }
  | { ok: false; reason: "refused" | "failed"; detail: string; calls: number };

export interface LaBonneBoite {
  /** The companies most likely to hire for `job` in `area`, best first, up to LA_BONNE_BOITE_PAGE_SIZE. Never throws. */
  search(query: { job: RomeResolution; area: LaBonneBoiteArea }, now: Date): Promise<LaBonneBoiteSearch>;
}

export interface FranceTravailApisOptions {
  clientId: string;
  clientSecret: string;
  /** Default: the global fetch. */
  fetch?: typeof globalThis.fetch;
  /** For the pace between calls. Default: real time. */
  clock?: Clock;
  /** Default: 15 s per call. */
  timeoutMs?: number;
}

class Refused extends Error {}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value.trim() : undefined);

/** One call to a France Travail API with its own token, at France Travail's pace. */
function createCaller(options: FranceTravailApisOptions) {
  const fetch = options.fetch ?? globalThis.fetch;
  const clock = options.clock ?? realClock;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const tokens: FranceTravailTokens = createFranceTravailTokens({ clientId: options.clientId, clientSecret: options.clientSecret, fetch, timeoutMs });
  /** When the next call may leave. */
  let notBefore = 0;

  const paced = async (send: () => Promise<Response>): Promise<Response> => {
    const wait = notBefore - clock.now();
    if (wait > 0) await clock.sleep(wait);
    try {
      return await send();
    } finally {
      notBefore = clock.now() + MIN_INTERVAL_MS;
    }
  };

  /**
   * The answer of `api` at `url`, its token asked first when none is kept; `calls` counts every HTTP call made.
   * Throws Refused when France Travail turns the client away, another Error on anything else.
   */
  return async function call(api: FranceTravailApi, url: string, init: RequestInit, now: Date, calls: { made: number }): Promise<unknown> {
    const token = await tokens.token(api, now);
    calls.made += token.calls;
    if (!token.ok) throw token.reason === "failed" ? new Error(token.detail) : new Refused(token.detail);
    const name = api === "la_bonne_boite" ? "La Bonne Boite" : "ROMEO";
    const send = () =>
      paced(() =>
        fetch(url, {
          ...init,
          headers: { ...init.headers, authorization: `Bearer ${token.value}`, accept: "application/json" },
          signal: AbortSignal.timeout(timeoutMs),
        }),
      );
    calls.made++;
    let answer = await send();
    if (answer.status === 429) {
      const seconds = Number(answer.headers.get("retry-after"));
      const waitMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : EMPTY_BUCKET_WAIT_MS;
      if (waitMs > MAX_RETRY_AFTER_MS) throw new Error(`${name} answered 429 (Retry-After ${seconds} s)`);
      await clock.sleep(waitMs);
      calls.made++;
      answer = await send();
    }
    if (answer.headers.get("x-ratelimit-remaining-clientidlimiter") === "0") notBefore = Math.max(notBefore, clock.now() + EMPTY_BUCKET_WAIT_MS);
    if (answer.status === 401) tokens.forget(api);
    if (answer.status === 401 || answer.status === 403) throw new Refused(`${name} refused (${answer.status})`);
    if (!answer.ok) throw new Error(`${name} answered ${answer.status}`);
    return answer.json();
  };
}

const outcome = (error: unknown, calls: number) =>
  ({ ok: false, reason: error instanceof Refused ? "refused" : "failed", detail: error instanceof Error ? error.message : String(error), calls }) as const;

/** The companies of a `/recherche` answer that name an establishment, best hiring first. */
export function readCompanies(answer: unknown): LaBonneBoiteCompany[] {
  const items = isObject(answer) && Array.isArray(answer.items) ? answer.items.filter(isObject) : [];
  const companies: LaBonneBoiteCompany[] = [];
  for (const item of items) {
    const [siret, name] = [str(item.siret), str(item.company_name) ?? str(item.office_name)];
    if (!siret || !name || !/^\d{14}$/.test(siret)) continue;
    const company: LaBonneBoiteCompany = { siret, name, hiringScore: typeof item.hiring_potential === "number" ? item.hiring_potential : 0 };
    const [city, activity] = [str(item.city), str(item.naf_label)];
    if (city) company.city = city;
    if (activity) company.activity = activity;
    companies.push(company);
  }
  return companies.sort((a, b) => b.hiringScore - a.hiringScore);
}

/** The ROME codes of a ROMEO answer scored ROMEO_MIN_SCORE or more, best first, each once. */
function readPrediction(answer: unknown): string[] {
  const first = Array.isArray(answer) ? answer.find(isObject) : undefined;
  const metiers = first && Array.isArray(first.metiersRome) ? first.metiersRome.filter(isObject) : [];
  const scored = metiers
    .map((metier) => ({ code: str(metier.codeRome), score: typeof metier.scorePrediction === "number" ? metier.scorePrediction : 0 }))
    .filter((metier): metier is { code: string; score: number } => metier.code !== undefined && /^[A-Z]\d{4}$/.test(metier.code) && metier.score >= ROMEO_MIN_SCORE)
    .sort((a, b) => b.score - a.score);
  return [...new Set(scored.map((metier) => metier.code))];
}

export function createFranceTravailApis(options: FranceTravailApisOptions): { laBonneBoite: LaBonneBoite; romeo: RomePredictor } {
  const call = createCaller(options);
  return {
    laBonneBoite: {
      async search({ job, area }, now) {
        const calls = { made: 0 };
        const params = new URLSearchParams();
        if (job.by === "job") params.set("job", job.job);
        else for (const code of job.codes) params.append("rome", code);
        if ("citycode" in area) {
          params.set("citycode", area.citycode);
          params.set("distance", String(area.distanceKm));
        } else params.set("location", area.location);
        params.set("page_size", String(LA_BONNE_BOITE_PAGE_SIZE));
        try {
          const answer = await call("la_bonne_boite", `${LA_BONNE_BOITE_URL}?${params}`, {}, now, calls);
          return { ok: true, companies: readCompanies(answer), calls: calls.made };
        } catch (error) {
          return outcome(error, calls.made);
        }
      },
    },
    romeo: {
      async predict(title, now): Promise<RomePrediction> {
        const calls = { made: 0 };
        const body = {
          appellations: [{ intitule: title.trim(), identifiant: "1" }],
          options: { nomAppelant: "jobbbox", nbResultats: 5, seuilScorePrediction: ROMEO_MIN_SCORE },
        };
        try {
          const answer = await call("romeo", ROMEO_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, now, calls);
          return { ok: true, codes: readPrediction(answer), calls: calls.made };
        } catch (error) {
          return outcome(error, calls.made);
        }
      },
    },
  };
}

/** La Bonne Boite and ROMEO from FRANCE_TRAVAIL_CLIENT_ID and FRANCE_TRAVAIL_CLIENT_SECRET, or null unless both are set. */
export function franceTravailApisFromEnv(
  env: Record<string, string | undefined>,
  options: Omit<FranceTravailApisOptions, "clientId" | "clientSecret"> = {},
): { laBonneBoite: LaBonneBoite; romeo: RomePredictor } | null {
  const clientId = env.FRANCE_TRAVAIL_CLIENT_ID?.trim();
  const clientSecret = env.FRANCE_TRAVAIL_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? createFranceTravailApis({ ...options, clientId, clientSecret }) : null;
}
