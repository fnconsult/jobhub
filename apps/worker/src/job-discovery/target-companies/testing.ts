/**
 * Target Companies kept in memory, as the web app's Postgres store keeps them (for tests):
 * La Bonne Boite's replaced at each refresh, the Candidate's own kept, set-aside ones never back,
 * one careers site per company for every Profile.
 */
import { companyKeyOf, type TargetCompany, type TargetCompanyStore } from "@jobhub/web/target-companies";

export interface MemoryTargetCompanyStore extends TargetCompanyStore {
  /** Every Target Company, set aside ones too, by Profile. */
  readonly rows: Map<string, (TargetCompany & { setAside: boolean })[]>;
  readonly sites: Map<string, string>;
  readonly refreshes: Map<string, { key: string; at: Date }>;
  /** Adds the Candidate's own company to a Profile, as they would on its page. */
  addOwn(profileId: string, company: { name: string; siren?: string }, at: Date): TargetCompany;
  /** Sets a Target Company aside, as the Candidate would. */
  setAside(profileId: string, id: string): void;
}

export function memoryTargetCompanies(): MemoryTargetCompanyStore {
  const rows = new Map<string, (TargetCompany & { setAside: boolean })[]>();
  const sites = new Map<string, string>();
  const refreshes = new Map<string, { key: string; at: Date }>();
  let ids = 0;
  const of = (profileId: string) => {
    let list = rows.get(profileId);
    if (!list) rows.set(profileId, (list = []));
    return list;
  };
  const strip = ({ setAside, ...company }: TargetCompany & { setAside: boolean }): TargetCompany => (void setAside, { ...company });

  return {
    rows,
    sites,
    refreshes,
    async list(profileId) {
      return of(profileId).filter((company) => !company.setAside).map(strip);
    },
    async lastRefresh(profileId) {
      return refreshes.get(profileId) ?? null;
    },
    async refresh(_candidateId, profileId, listing, at) {
      const list = of(profileId);
      const given = new Map(listing.companies.map((company) => [companyKeyOf(company), company]));
      rows.set(profileId, list.filter((company) => company.origin === "candidate" || company.setAside || given.has(company.companyKey)));
      for (const [key, company] of given) {
        const kept = of(profileId).find((row) => row.companyKey === key);
        if (kept) {
          if (kept.origin === "la_bonne_boite") Object.assign(kept, { hiringScore: company.hiringScore, city: company.city ?? null });
          continue;
        }
        of(profileId).push({
          id: `target-${++ids}`,
          companyKey: key,
          name: company.name,
          origin: "la_bonne_boite",
          hiringScore: company.hiringScore,
          city: company.city ?? null,
          activity: company.activity ?? null,
          headcount: company.headcount ? { min: company.headcount.min, max: company.headcount.max ?? null } : null,
          addedAt: at,
          lastVisitedAt: null,
          notACompanyAt: null,
          setAside: false,
        });
      }
      refreshes.set(profileId, { key: listing.key, at });
    },
    async visited(profileId, visited, at) {
      for (const company of of(profileId)) if (visited.includes(company.id)) company.lastVisitedAt = at;
    },
    async notACompany(profileId, ids, at) {
      for (const company of of(profileId)) if (ids.includes(company.id)) company.notACompanyAt = at;
    },
    async careersSites(keys) {
      return new Map(keys.flatMap((key) => (sites.has(key) ? [[key, sites.get(key)!] as const] : [])));
    },
    async keepCareersSite(key, url) {
      sites.set(key, url);
    },
    addOwn(profileId, company, at) {
      const row = {
        id: `target-${++ids}`,
        companyKey: companyKeyOf(company),
        name: company.name,
        origin: "candidate" as const,
        hiringScore: null,
        city: null,
        activity: null,
        headcount: null,
        addedAt: at,
        lastVisitedAt: null,
        notACompanyAt: null,
        setAside: false,
      };
      of(profileId).push(row);
      return strip(row);
    },
    setAside(profileId, id) {
      const row = of(profileId).find((company) => company.id === id);
      if (row) row.setAside = true;
    },
  };
}
