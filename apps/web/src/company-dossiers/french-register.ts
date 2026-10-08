/**
 * The French company register, read through the open API Recherche d'Entreprises
 * (https://recherche-entreprises.api.gouv.fr, no key, about 7 calls per second).
 *
 * This adapter is where register data enters the app, so it is where private
 * persons are dropped: executives come back as their roles only (no name, no
 * birth date), and sole traders, whose company name is their own, are left out.
 * Nothing about a person is ever stored or shown from here.
 */

import { nameKey, sirenIn } from "./company-names";

export interface FinancialYear {
  year: number;
  /** Turnover (chiffre d'affaires), in euros. */
  revenue?: number;
  /** Net result, in euros. Negative for a loss. */
  netIncome?: number;
}

/** A company found in the French register. */
export interface RegisteredCompany {
  siren: string;
  name: string;
  /** The acronym (sigle) the register lists. */
  acronym?: string;
  /**
   * The head office's shop signs (enseignes), e.g. BLABLACAR for COMUTO. Not a name to search
   * by (franchisees and subsidiaries trade under the group's), only to confirm a SIREN found elsewhere.
   */
  shopSigns?: string[];
  /** False once the company has ceased trading. */
  active: boolean;
  /** e.g. "SAS", when the register's legal category is a common one. */
  legalForm?: string;
  /** NAF code of the main activity, e.g. "28.29B". */
  activity?: string;
  /** Head office address. */
  address?: string;
  /** Employee headcount range; `max` is absent for the top range. */
  headcount?: { min: number; max?: number };
  /** PME, ETI or GE (grande entreprise). */
  category?: "PME" | "ETI" | "GE";
  /** Newest year first; empty when the register publishes none. */
  financials: FinancialYear[];
  /** Roles of the company's executives as registered (e.g. "Président de SAS"), never their names. Auditors left out. */
  executiveRoles: string[];
}

export interface RegisterSearch {
  /** Companies matching the query, in the register's order of relevance. Sole traders are left out. */
  companies: RegisteredCompany[];
  /**
   * A sole trader is registered under exactly the queried name or SIREN: the query
   * names a private person. Only this yes/no leaves the adapter, never the person.
   */
  soleTraderNamed: boolean;
}

export interface CompanyRegister {
  /** What the register lists under `query` (a name or a SIREN). */
  search(query: string): Promise<RegisterSearch>;
}

/** The register could not answer (rate limit, outage, timeout). Try again later. */
export class CompanyRegisterUnavailable extends Error {
  override name = "CompanyRegisterUnavailable";
}

/** INSEE headcount ranges ("tranche d'effectif salarié"). */
const HEADCOUNTS: Record<string, { min: number; max?: number }> = {
  "00": { min: 0, max: 0 },
  "01": { min: 1, max: 2 },
  "02": { min: 3, max: 5 },
  "03": { min: 6, max: 9 },
  "11": { min: 10, max: 19 },
  "12": { min: 20, max: 49 },
  "21": { min: 50, max: 99 },
  "22": { min: 100, max: 199 },
  "31": { min: 200, max: 249 },
  "32": { min: 250, max: 499 },
  "41": { min: 500, max: 999 },
  "42": { min: 1000, max: 1999 },
  "51": { min: 2000, max: 4999 },
  "52": { min: 5000, max: 9999 },
  "53": { min: 10000 },
};

/** Common INSEE legal categories ("catégorie juridique"), by code or code prefix. */
function legalFormOf(code: string | null | undefined): string | undefined {
  if (!code) return undefined;
  if (code === "5710") return "SAS";
  if (code === "5720") return "SASU";
  if (code === "5498") return "EURL";
  if (code.startsWith("54")) return "SARL";
  if (code.startsWith("55") || code.startsWith("56")) return "SA";
  if (code === "5800") return "SE";
  if (code.startsWith("53")) return "SCA";
  if (code.startsWith("52")) return "SNC";
  if (code.startsWith("92")) return "Association";
  return undefined;
}

interface ApiExecutive {
  qualite?: string | null;
  type_dirigeant?: string;
}

interface ApiCompany {
  siren: string;
  nom_complet?: string | null;
  nom_raison_sociale?: string | null;
  sigle?: string | null;
  siege?: { adresse?: string | null; liste_enseignes?: string[] | null } | null;
  activite_principale?: string | null;
  categorie_entreprise?: string | null;
  dirigeants?: ApiExecutive[] | null;
  etat_administratif?: string | null;
  nature_juridique?: string | null;
  tranche_effectif_salarie?: string | null;
  finances?: Record<string, { ca?: number | null; resultat_net?: number | null }> | null;
  complements?: { est_entrepreneur_individuel?: boolean | null } | null;
}

/** The registered name; empty for a SIREN the register holds no company under, which it answers with an all-null record. */
const nameOf = (company: ApiCompany) => (company.nom_raison_sociale || company.nom_complet || "").trim();

const isSoleTrader = (company: ApiCompany) => company.complements?.est_entrepreneur_individuel === true || company.nature_juridique === "1000";

function companyFrom(company: ApiCompany): RegisteredCompany {
  const name = nameOf(company);
  const result: RegisteredCompany = {
    siren: company.siren,
    name,
    active: company.etat_administratif !== "C",
    financials: Object.entries(company.finances ?? {})
      .map(([year, figures]) => {
        const financialYear: FinancialYear = { year: Number(year) };
        if (typeof figures?.ca === "number") financialYear.revenue = figures.ca;
        if (typeof figures?.resultat_net === "number") financialYear.netIncome = figures.resultat_net;
        return financialYear;
      })
      .filter((financialYear) => Number.isInteger(financialYear.year) && ("revenue" in financialYear || "netIncome" in financialYear))
      .sort((a, b) => b.year - a.year),
    // Only the role ("qualité") is read: names and birth dates never leave this function.
    executiveRoles: [
      ...new Set(
        (company.dirigeants ?? [])
          .map((executive) => executive.qualite?.trim() ?? "")
          .filter((role) => role !== "" && !/commissaire aux comptes/i.test(role)),
      ),
    ],
  };
  const acronym = company.sigle?.trim();
  if (acronym && acronym !== name) result.acronym = acronym;
  const legalForm = legalFormOf(company.nature_juridique);
  if (legalForm) result.legalForm = legalForm;
  const shopSigns = [...new Set((company.siege?.liste_enseignes ?? []).map((sign) => sign?.trim()).filter((sign): sign is string => !!sign))];
  if (shopSigns.length > 0) result.shopSigns = shopSigns;
  if (company.activite_principale) result.activity = company.activite_principale;
  if (company.siege?.adresse) result.address = company.siege.adresse;
  const headcount = HEADCOUNTS[company.tranche_effectif_salarie ?? ""];
  if (headcount) result.headcount = { ...headcount };
  if (company.categorie_entreprise === "PME" || company.categorie_entreprise === "ETI" || company.categorie_entreprise === "GE") {
    result.category = company.categorie_entreprise;
  }
  return result;
}

export interface FrenchRegisterOptions {
  fetch?: typeof globalThis.fetch;
  /** Default https://recherche-entreprises.api.gouv.fr */
  baseUrl?: string;
  /** Default 8 seconds. */
  timeoutMs?: number;
}

/** The register accepts queries of 3 characters or more. */
const MIN_QUERY_LENGTH = 3;

export function createFrenchRegister(options: FrenchRegisterOptions = {}): CompanyRegister {
  const fetch = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? "https://recherche-entreprises.api.gouv.fr";
  return {
    async search(query) {
      const q = query.trim();
      if (q.length < MIN_QUERY_LENGTH) return { companies: [], soleTraderNamed: false };
      const url = new URL("/search", baseUrl);
      url.searchParams.set("q", q);
      url.searchParams.set("per_page", "10");
      let response: Response;
      try {
        response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(options.timeoutMs ?? 8000) });
      } catch (error) {
        throw new CompanyRegisterUnavailable("The French company register could not be reached", { cause: error });
      }
      if (!response.ok) throw new CompanyRegisterUnavailable(`The French company register answered ${response.status}`);
      const body = (await response.json().catch(() => null)) as { results?: ApiCompany[] } | null;
      // A record with no name is no company: the register answers an unknown SIREN with one.
      const results = (body?.results ?? []).filter((company) => company?.siren && nameOf(company));
      const siren = sirenIn(q);
      const key = nameKey(q);
      const named = (company: ApiCompany) =>
        siren ? company.siren === siren : [company.nom_raison_sociale, company.nom_complet].some((name) => !!name && nameKey(name) === key);
      return {
        companies: results.filter((company) => !isSoleTrader(company)).map(companyFrom),
        soleTraderNamed: results.some((company) => isSoleTrader(company) && named(company)),
      };
    },
  };
}
