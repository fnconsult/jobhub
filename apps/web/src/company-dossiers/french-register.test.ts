import { describe, expect, it } from "vitest";
import { CompanyRegisterUnavailable, createFrenchRegister } from "./french-register";

/** Shaped like a recherche-entreprises.api.gouv.fr search result; the company and people are made up. */
const acme = {
  siren: "552100554",
  nom_complet: "ACME INDUSTRIE (ACME)",
  nom_raison_sociale: "ACME INDUSTRIE",
  sigle: "ACME",
  siege: {
    adresse: "12 RUE DE LA REPUBLIQUE 69002 LYON",
    activite_principale: "28.29B",
    etat_administratif: "A",
    liste_enseignes: ["ACME LYON"],
    tranche_effectif_salarie: "22",
  },
  activite_principale: "28.29B",
  categorie_entreprise: "ETI",
  dirigeants: [
    { nom: "MARTIN", prenoms: "PAULINE ANNE", annee_de_naissance: "1968", date_de_naissance: "1968-04", qualite: "Président de SAS", type_dirigeant: "personne physique" },
    { nom: "DURAND", prenoms: "LUC", annee_de_naissance: "1970", date_de_naissance: "1970-01", qualite: "Directeur Général", type_dirigeant: "personne physique" },
    { siren: "572028041", denomination: "AUDIT & ASSOCIES", qualite: "Commissaire aux comptes titulaire", type_dirigeant: "personne morale" },
  ],
  etat_administratif: "A",
  nature_juridique: "5710",
  tranche_effectif_salarie: "32",
  finances: { "2023": { ca: 41_000_000, resultat_net: 1_200_000 }, "2024": { ca: 45_500_000, resultat_net: -300_000 } },
  complements: { est_entrepreneur_individuel: false },
};

const soleTrader = {
  ...acme,
  siren: "812345678",
  nom_complet: "PAULINE MARTIN",
  nom_raison_sociale: null,
  sigle: null,
  nature_juridique: "1000",
  dirigeants: [],
  finances: null,
  complements: { est_entrepreneur_individuel: true },
};

function fakeFetch(respond: (url: URL) => Response) {
  const urls: URL[] = [];
  const fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    urls.push(url);
    return respond(url);
  }) as typeof globalThis.fetch;
  return { fetch, urls };
}

describe("French company register (API Recherche d'Entreprises)", () => {
  it("finds companies by name with their SIREN, identity, address, headcount and financials, newest year first", async () => {
    const { fetch, urls } = fakeFetch(() => Response.json({ results: [acme], total_results: 1 }));
    const register = createFrenchRegister({ fetch });

    const companies = await register.search("Acme Industrie");

    expect(urls[0]!.origin).toBe("https://recherche-entreprises.api.gouv.fr");
    expect(urls[0]!.searchParams.get("q")).toBe("Acme Industrie");
    expect(companies).toEqual([
      {
        siren: "552100554",
        name: "ACME INDUSTRIE",
        otherNames: ["ACME", "ACME LYON"],
        active: true,
        legalForm: "SAS",
        activity: "28.29B",
        address: "12 RUE DE LA REPUBLIQUE 69002 LYON",
        headcount: { min: 250, max: 499 },
        category: "ETI",
        financials: [
          { year: 2024, revenue: 45_500_000, netIncome: -300_000 },
          { year: 2023, revenue: 41_000_000, netIncome: 1_200_000 },
        ],
        executiveRoles: ["Président de SAS", "Directeur Général"],
      },
    ]);
  });

  it("never lets a private person's name or birth date out: executives come back as roles only", async () => {
    const { fetch } = fakeFetch(() => Response.json({ results: [acme] }));

    const companies = await createFrenchRegister({ fetch }).search("Acme");

    const text = JSON.stringify(companies);
    expect(text).not.toMatch(/MARTIN|PAULINE|DURAND|LUC\b|1968|1970/);
  });

  it("leaves sole traders out, since their name is a private person's", async () => {
    const { fetch } = fakeFetch(() => Response.json({ results: [soleTrader, acme] }));

    const companies = await createFrenchRegister({ fetch }).search("Martin");

    expect(companies.map((company) => company.siren)).toEqual(["552100554"]);
  });

  it("gives no financials when the register has none", async () => {
    const { fetch } = fakeFetch(() => Response.json({ results: [{ ...acme, finances: null }] }));

    const [company] = await createFrenchRegister({ fetch }).search("Acme");

    expect(company!.financials).toEqual([]);
  });

  it("does not call the register for a name shorter than it accepts", async () => {
    const { fetch, urls } = fakeFetch(() => Response.json({ results: [] }));

    expect(await createFrenchRegister({ fetch }).search(" AB ")).toEqual([]);
    expect(urls).toHaveLength(0);
  });

  it.each([429, 500, 503])("reports the register unavailable when it answers %i", async (status) => {
    const { fetch } = fakeFetch(() => new Response("busy", { status }));

    await expect(createFrenchRegister({ fetch }).search("Acme")).rejects.toBeInstanceOf(CompanyRegisterUnavailable);
  });

  it("reports the register unavailable when it cannot be reached", async () => {
    const fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof globalThis.fetch;

    await expect(createFrenchRegister({ fetch }).search("Acme")).rejects.toBeInstanceOf(CompanyRegisterUnavailable);
  });
});
