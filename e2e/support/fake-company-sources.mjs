// Preloaded into the e2e web server (NODE_OPTIONS=--import) to stand in for the
// public sources of a Company Dossier (issue #17). Nothing reaches the real ones.
//
// The French register (recherche-entreprises.api.gouv.fr) lists one made-up
// company, ACME INDUSTRIE (SIREN 552100554), with financials and two executives
// whose names (PAULINE MARTIN, LUC DURAND) must never reach a page. A query for
// "Sans Chiffres" finds a company that publishes no financials; a query for
// "Grande Marque" finds a large company (SIREN 552100556) among small homonyms
// and its French subsidiary, as for Orange or Capgemini; a query
// containing "E2E_REGISTER_DOWN" gets a 429; anything else finds nothing.
//
// Perplexity's web search answers for any company with made-up facts about
// "Globex Robotics" in Germany, including a CEO's name (Hans Müller) the
// dossier must drop, and one source. For "PersonLeak", it answers with a
// person's name and home address in the facts and a LinkedIn profile among the
// sources, none of which may reach the page.
const realFetch = globalThis.fetch;

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
const noFigures = { ...acme, siren: "552100555", nom_complet: "SANS CHIFFRES", nom_raison_sociale: "SANS CHIFFRES", finances: null };

globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin === "https://recherche-entreprises.api.gouv.fr") {
    const q = url.searchParams.get("q") ?? "";
    if (q.includes("E2E_REGISTER_DOWN")) return new Response("Too many requests", { status: 429 });
    const results =
      /acme/i.test(q) || q.replace(/\s/g, "") === acme.siren ? [acme] : /sans chiffres/i.test(q) ? [noFigures] : /grande marque/i.test(q) ? grandeMarque : [];
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
      });
      return Response.json({
        id: "cmpl_e2e_leak",
        model: "sonar",
        choices: [{ index: 0, message: { role: "assistant", content: leak }, finish_reason: "stop" }],
        search_results: [{ url: "https://www.linkedin.com/in/john-smith-austin" }, { url: "javascript:alert(1)" }, { url: "https://personleak.example/about" }],
        usage: { prompt_tokens: 20, completion_tokens: 40 },
      });
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
    return Response.json({
      id: "cmpl_e2e_search",
      model: "sonar",
      choices: [{ index: 0, message: { role: "assistant", content: answer }, finish_reason: "stop" }],
      search_results: [{ url: "https://globex-robotics.example/about" }],
      usage: { prompt_tokens: 20, completion_tokens: 40 },
    });
  }
  return realFetch(input, init);
};
