/**
 * The Target Companies a Job discovery run visits for a Profile (CONTEXT.md, #406):
 *
 *   const targets = createTargetCompanies({ store, franceTravail, cityCodes, settings });
 *   const run = await targets.forRun({ candidateId, profileId, criteria, now });
 *   // run.laBonneBoite: { status: "off" | "kept" | "searched" | "refused" | "failed", calls }
 *   // run.visits: [{ id, companyKey, name, careersSite }]: those to visit now, in order
 *   await targets.visited(profileId, run.visits, now);          // once the run has visited them
 *   await targets.keepCareersSite(visit, url, now);              // a careers site found for one, kept for every Profile
 *
 * The Profile's list is refreshed from La Bonne Boite (France Travail's companies likely to hire)
 * at most monthly for the same job and area, and as soon as its Search Criteria title or first
 * place changed: the title's ROME codes (Jobbbox's table, else ROMEO's prediction, else the title
 * as free text, see ../france-travail/rome-resolution.ts), within 30 km of the place's commune
 * (geo.api.gouv.fr), else around the place as La Bonne Boite reads it. Only the job and the area
 * leave (ADR-0007). La Bonne Boite refused or down is skipped like an unavailable source: the list
 * stays as it was, and it is asked again next run.
 *
 * A run visits up to `max` of them (JOB_DISCOVERY_TARGET_COMPANIES, 5 by default), the Candidate's
 * own first, then by hiring score, none visited within `revisitDays` (JOB_DISCOVERY_TARGET_COMPANY_REVISIT_DAYS,
 * 7 by default); those set aside never. Never throws: what cannot be read gives no visit.
 */
import { locationKey, type SearchCriteria } from "@jobhub/shared";
import { readNumberSetting } from "@jobhub/web/platform-settings";
import type { TargetCompany, TargetCompanyStore } from "@jobhub/web/target-companies";
import type { LaBonneBoite, LaBonneBoiteArea } from "../france-travail/la-bonne-boite";
import { resolveRome, type RomePredictor } from "../france-travail/rome-resolution";
import type { CityCodes } from "./city-codes";

export { createCityCodes, type CityCodes } from "./city-codes";

const DAY_MS = 24 * 60 * 60 * 1000;
/** La Bonne Boite's data changes monthly: a list fetched less long ago for the same job and area is kept. */
export const LA_BONNE_BOITE_REFRESH_DAYS = 30;
/** The radius around the Search Criteria's commune, the Search Criteria stating none. */
export const DEFAULT_RADIUS_KM = 30;

export interface TargetCompanySettings {
  /** How many Target Companies a run visits at most. */
  max: number;
  /** How many days before a Target Company is visited again. */
  revisitDays: number;
}

/** JOB_DISCOVERY_TARGET_COMPANIES and JOB_DISCOVERY_TARGET_COMPANY_REVISIT_DAYS (Platform Settings: bounds and defaults are the catalog's). */
export function targetCompanySettingsFromEnv(env: Record<string, string | undefined>): TargetCompanySettings {
  return { max: readNumberSetting(env, "JOB_DISCOVERY_TARGET_COMPANIES"), revisitDays: readNumberSetting(env, "JOB_DISCOVERY_TARGET_COMPANY_REVISIT_DAYS") };
}

/** One Target Company to visit in this run, and its careers site (or ATS board) when one is known. */
export interface TargetCompanyVisit {
  id: string;
  companyKey: string;
  name: string;
  careersSite: string | null;
}

export type LaBonneBoiteStatus = "off" | "kept" | "searched" | "refused" | "failed";

export interface TargetCompaniesForRun {
  /** `off`: France Travail is not configured; `kept`: the list fetched within the month was used; `searched`: it was fetched now. */
  laBonneBoite: { status: LaBonneBoiteStatus; calls: number };
  visits: TargetCompanyVisit[];
}

export interface TargetCompanies {
  /**
   * The Target Companies to visit in this run, La Bonne Boite's refreshed first when due. `step`, when given, wraps
   * the calls to France Travail and geo.api.gouv.fr (a step of the run's Provenance): it is called only when they are made.
   */
  forRun(request: {
    candidateId: string;
    profileId: string;
    criteria: SearchCriteria;
    now: Date;
    step?: <T>(work: () => Promise<T>) => Promise<T>;
  }): Promise<TargetCompaniesForRun>;
  /** The run visited them. Never throws. */
  visited(profileId: string, visits: readonly TargetCompanyVisit[], now: Date): Promise<void>;
  /** The run found `url` as `visit`'s careers site: kept for its company, for every Profile. Never throws. */
  keepCareersSite(visit: TargetCompanyVisit, url: string, now: Date): Promise<void>;
}

export interface TargetCompaniesOptions {
  store: TargetCompanyStore;
  /** La Bonne Boite and ROMEO, asked on each run: null without France Travail's credentials. Default: none. */
  franceTravail?: () => { laBonneBoite: LaBonneBoite; romeo: RomePredictor | null } | null;
  /** The INSEE code of a place's commune. */
  cityCodes: CityCodes;
  /** Asked on each run. Default: the catalog's (5 Target Companies, 7 days). */
  settings?: () => TargetCompanySettings;
  log?: (line: string) => void;
}

/**
 * The Target Companies to visit now: the Candidate's own first (oldest added first), then La Bonne Boite's by
 * hiring score, none visited less than `revisitDays` ago, at most `max`.
 */
export function pickTargetCompanies<T extends Pick<TargetCompany, "origin" | "hiringScore" | "lastVisitedAt" | "addedAt">>(
  companies: readonly T[],
  { max, revisitDays, now }: TargetCompanySettings & { now: Date },
): T[] {
  const due = companies.filter((company) => !company.lastVisitedAt || now.getTime() - company.lastVisitedAt.getTime() >= revisitDays * DAY_MS);
  const rank = (company: T) => (company.origin === "candidate" ? 0 : 1);
  return [...due]
    .sort((a, b) => rank(a) - rank(b) || (b.hiringScore ?? 0) - (a.hiringScore ?? 0) || a.addedAt.getTime() - b.addedAt.getTime())
    .slice(0, Math.max(0, Math.floor(max)));
}

/** What a Profile's La Bonne Boite companies are fetched for: its title and first place, compared without case or accents. */
const listingKey = (criteria: SearchCriteria) => `${locationKey(criteria.targetRole)}|${locationKey(criteria.locations[0] ?? "")}`;

export function createTargetCompanies(options: TargetCompaniesOptions): TargetCompanies {
  const log = options.log ?? ((line: string) => console.warn(line));
  const settings = () => options.settings?.() ?? targetCompanySettingsFromEnv({});

  /** Refreshes the Profile's La Bonne Boite companies when due; what La Bonne Boite did. */
  async function refreshed(request: Parameters<TargetCompanies["forRun"]>[0]): Promise<TargetCompaniesForRun["laBonneBoite"]> {
    const apis = options.franceTravail?.() ?? null;
    const location = request.criteria.locations[0];
    if (!apis || !location) return { status: "off", calls: 0 };
    const key = listingKey(request.criteria);
    const last = await options.store.lastRefresh(request.profileId);
    if (last && last.key === key && request.now.getTime() - last.at.getTime() < LA_BONNE_BOITE_REFRESH_DAYS * DAY_MS) return { status: "kept", calls: 0 };
    const step = request.step ?? (<T>(work: () => Promise<T>) => work());
    return step(async () => {
      const [{ resolution, calls: romeoCalls }, cityCode] = await Promise.all([
        resolveRome(request.criteria.targetRole, { romeo: apis.romeo, now: request.now }),
        options.cityCodes.cityCode(location),
      ]);
      const area: LaBonneBoiteArea = cityCode ? { citycode: cityCode, distanceKm: DEFAULT_RADIUS_KM } : { location };
      const found = await apis.laBonneBoite.search({ job: resolution, area }, request.now);
      const calls = romeoCalls + found.calls;
      if (!found.ok) {
        log(`[job-discovery] La Bonne Boite ${found.reason}, its step skipped: ${found.detail}`);
        return { status: found.reason, calls };
      }
      await options.store.refresh(request.candidateId, request.profileId, { key, companies: found.companies }, request.now);
      return { status: "searched", calls };
    });
  }

  return {
    async forRun(request) {
      let laBonneBoite: TargetCompaniesForRun["laBonneBoite"] = { status: "off", calls: 0 };
      try {
        laBonneBoite = await refreshed(request);
      } catch (error) {
        log(`[job-discovery] the Target Companies could not be refreshed: ${error instanceof Error ? error.message : String(error)}`);
        laBonneBoite = { status: "failed", calls: 0 };
      }
      try {
        const picked = pickTargetCompanies(await options.store.list(request.profileId), { ...settings(), now: request.now });
        const sites = await options.store.careersSites(picked.map((company) => company.companyKey));
        const visits = picked.map(({ id, companyKey, name }) => ({ id, companyKey, name, careersSite: sites.get(companyKey) ?? null }));
        return { laBonneBoite, visits };
      } catch (error) {
        log(`[job-discovery] the Target Companies could not be read, none visited: ${error instanceof Error ? error.message : String(error)}`);
        return { laBonneBoite, visits: [] };
      }
    },

    async visited(profileId, visits, now) {
      if (visits.length === 0) return;
      await options.store.visited(profileId, visits.map((visit) => visit.id), now).catch((error: unknown) => log(`[job-discovery] Target Company visits not recorded: ${String(error)}`));
    },

    async keepCareersSite(visit, url, now) {
      await options.store.keepCareersSite(visit.companyKey, url, now).catch((error: unknown) => log(`[job-discovery] careers site not kept: ${String(error)}`));
    },
  };
}
