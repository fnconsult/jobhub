// Preloaded into the e2e web server (NODE_OPTIONS=--import) to stand in for the
// public sources of a Company Dossier (issue #17). Nothing reaches the real ones.
//
// The French register (recherche-entreprises.api.gouv.fr) lists one made-up
// company, ACME INDUSTRIE (SIREN 552100554), with financials and two executives
// whose names (PAULINE MARTIN, LUC DURAND) must never reach a page. A query for
// "Sans Chiffres" finds a company that publishes no financials; a query for
// "Grande Marque" finds a large company (SIREN 552100556) among small homonyms
// and its French subsidiary, as for Orange or Capgemini; a query
// containing "E2E_REGISTER_DOWN" gets a 429; "Bibendum" finds only two small
// homonyms, the group being registered as COMPAGNIE GENERALE DES ETABLISSEMENTS
// BIBENDUM (SIREN 552100557), as for Michelin; SIREN 123456789 gets the
// all-null record the live register answers it with; anything else finds nothing.
//
// Perplexity's web search answers for any company with made-up facts about
// "Globex Robotics" in Germany, including a CEO's name (Hans Müller) the
// dossier must drop, and one source. For "PersonLeak", it answers with a
// person's name and home address in the facts and a LinkedIn profile among the
// sources and as its website, none of which may reach the page. For "Bibendum",
// it gives the group's SIREN.
const realFetch = globalThis.fetch;

/** Perplexity's Agent API (POST /v1/responses): `text` as the answer, `sources` as its search results. */
function perplexityAnswer(text, sources) {
  return Response.json({
    id: "resp_e2e",
    object: "response",
    status: "completed",
    model: "openai/gpt-6-luna",
    output: [
      { type: "search_results", queries: ["e2e"], results: sources.map(({ url }, id) => ({ id, url, title: "", snippet: "" })) },
      { type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] },
    ],
    usage: { input_tokens: 20, output_tokens: 40, total_tokens: 60 },
  });
}

const acme = {
  siren: "552100554",
  nom_complet: "ACME INDUSTRIE",
  nom_raison_sociale: "ACME INDUSTRIE",
  sigle: null,
  siege: { adresse: "12 RUE DE LA REPUBLIQUE 69002 LYON", etat_administratif: "A", liste_enseignes: null },
  activite_principale: "28.29B",
  categorie_entreprise: "ETI",
  dirigeants: [
    { nom: "MARTIN", prenoms: "PAULINE", annee_de_naissance: "1968", qualite: "Président de SAS", type_dirigeant: "personne physique" },
    { nom: "DURAND", prenoms: "LUC", annee_de_naissance: "1970", qualite: "Directeur Général", type_dirigeant: "personne physique" },
  ],
  etat_administratif: "A",
  nature_juridique: "5710",
  tranche_effectif_salarie: "32",
  finances: { "2023": { ca: 41000000, resultat_net: 1200000 }, "2024": { ca: 45500000, resultat_net: -300000 } },
  complements: { est_entrepreneur_individuel: false },
};
const smallCompany = { ...acme, categorie_entreprise: "PME", tranche_effectif_salarie: "NN", finances: null, dirigeants: [] };
const grandeMarque = [
  { ...smallCompany, siren: "814000001", nom_complet: "GRANDE MARQUE", nom_raison_sociale: "GRANDE MARQUE" },
  { ...acme, siren: "552100556", nom_complet: "GRANDE MARQUE", nom_raison_sociale: "GRANDE MARQUE", categorie_entreprise: "GE", tranche_effectif_salarie: "53" },
  { ...smallCompany, siren: "814000002", nom_complet: "GRANDE MARQUE", nom_raison_sociale: "GRANDE MARQUE", categorie_entreprise: null },
  { ...acme, siren: "814000003", nom_complet: "GRANDE MARQUE FRANCE", nom_raison_sociale: "GRANDE MARQUE FRANCE", categorie_entreprise: "GE" },
];
const bibendum = [
  { ...smallCompany, siren: "814000004", nom_complet: "BIBENDUM", nom_raison_sociale: "BIBENDUM", categorie_entreprise: null },
  { ...smallCompany, siren: "814000005", nom_complet: "BIBENDUM", nom_raison_sociale: "BIBENDUM", categorie_entreprise: null },
];
const bibendumGroup = {
  ...acme,
  siren: "552100557",
  nom_complet: "COMPAGNIE GENERALE DES ETABLISSEMENTS BIBENDUM (CGEB)",
  nom_raison_sociale: "COMPAGNIE GENERALE DES ETABLISSEMENTS BIBENDUM",
  sigle: "CGEB",
  categorie_entreprise: "GE",
  tranche_effectif_salarie: "53",
};
const emptyRecord = { siren: "123456789", nom_complet: null, nom_raison_sociale: null, sigle: null, siege: {}, dirigeants: [], etat_administratif: null, nature_juridique: null, finances: null };
const noFigures = { ...acme, siren: "552100555", nom_complet: "SANS CHIFFRES", nom_raison_sociale: "SANS CHIFFRES", finances: null };

globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin === "https://recherche-entreprises.api.gouv.fr") {
    const q = url.searchParams.get("q") ?? "";
    if (q.includes("E2E_REGISTER_DOWN")) return new Response("Too many requests", { status: 429 });
    const digits = q.replace(/\s/g, "");
    const results =
      /acme/i.test(q) || digits === acme.siren
        ? [acme]
        : /sans chiffres/i.test(q)
          ? [noFigures]
          : /grande marque/i.test(q)
            ? grandeMarque
            : /bibendum/i.test(q)
              ? bibendum
              : digits === bibendumGroup.siren
                ? [bibendumGroup]
                : digits === emptyRecord.siren
                  ? [emptyRecord]
                  : [];
    return Response.json({ results, total_results: results.length, page: 1, per_page: 10, total_pages: 1 });
  }
  if (url.origin === "https://api.perplexity.ai") {
    const query = JSON.stringify(init?.body ?? "");
    if (query.includes("PersonLeak")) {
      const leak = JSON.stringify({
        country: "États-Unis",
        headquarters: "Home office of John Smith, 12 Elm St, Austin",
        industry: "Software, founded by Jane Doe",
        headcount: "12 salariés",
        website: "https://www.linkedin.com/in/john-smith-austin",
      });
      return perplexityAnswer(leak, [{ url: "https://www.linkedin.com/in/john-smith-austin" }, { url: "javascript:alert(1)" }, { url: "https://personleak.example/about" }]);
    }
    if (query.includes("Bibendum")) {
      return perplexityAnswer(JSON.stringify({ country: "France", siren: "552 100 557" }), [{ url: "https://bibendum.example/groupe" }]);
    }
    const answer = JSON.stringify({
      country: "Allemagne",
      headquarters: "Munich",
      industry: "Robotique industrielle",
      headcount: "1 200 salariés",
      revenue: "300 M€ (2024)",
      website: "globex-robotics.example",
      ceo: "Hans Müller",
    });
    return perplexityAnswer(answer, [{ url: "https://globex-robotics.example/about" }]);
  }
  return realFetch(input, init);
};
