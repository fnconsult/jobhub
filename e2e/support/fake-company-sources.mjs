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
// Perplexity's Search API (POST /search, ADR-0043) returns pages, never written text: for any company,
// a page about "Globex Robotics" in Germany whose text names a CEO (Hans Müller) the dossier must drop.
// For "PersonLeak", pages naming a person and their home address, a LinkedIn profile among them, none
// of which may reach the page. For "Bibendum", a page giving the group's SIREN. Until the company-facts
// Task Playbook's agent reads such pages (#405), no facts are written from them.
//
// Its search for an employer's Company News (the query asking for "Articles de presse") answers
// with three article pages: one from last month; one older than twelve months and one whose title
// names a person (Hans Müller). For "Sans Chiffres", with none. For an employer holding
// "E2E_SLOW_NEWS", it takes 30 s, or rejects at once when the Candidate stops the dossier (#335), as fetch does.
const realFetch = globalThis.fetch;

/** Waits `ms`, or rejects with `signal`'s reason once it aborts, as fetch does. */
function answerAfter(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(timer), reject(signal.reason)), { once: true });
  });
}

/** The calendar day `days` ago, YYYY-MM-DD. */
const daysAgo = (days) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

/** Perplexity's Search API (POST /search): the result pages, each with its title, URL, snippet and date when known. */
function perplexityPages(pages) {
  return Response.json({
    id: "search_e2e",
    results: pages.map(({ url, title = "", snippet = "", date = null }) => ({ title, url, snippet, date, last_updated: null })),
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
    if (query.includes("Articles de presse")) {
      if (query.includes("E2E_SLOW_NEWS")) await answerAfter(30_000, input instanceof Request ? input.signal : init?.signal);
      const articles = /sans chiffres/i.test(query)
        ? []
        : [
            { title: "Une nouvelle usine de robots inaugurée", outlet: "Le Journal de l'Industrie", date: daysAgo(20), url: "https://news.example/nouvelle-usine", namesPerson: false },
            { title: "Des résultats annuels en hausse", outlet: "Éco Hebdo", date: daysAgo(400), url: "https://news.example/resultats-anciens", namesPerson: false },
            { title: "Hans Müller quitte la direction du groupe", outlet: "Éco Hebdo", date: daysAgo(10), url: "https://news.example/depart", namesPerson: false },
          ];
      return perplexityPages(articles.map(({ url, title, outlet, date }) => ({ url, title: `${title} - ${outlet}`, date })));
    }
    if (query.includes("PersonLeak")) {
      return perplexityPages([
        { url: "https://www.linkedin.com/in/john-smith-austin", title: "John Smith - PersonLeak", snippet: "Home office of John Smith, 12 Elm St, Austin." },
        { url: "javascript:alert(1)", title: "PersonLeak" },
        { url: "https://personleak.example/about", title: "About PersonLeak", snippet: "Software, founded by Jane Doe. 12 employees." },
      ]);
    }
    if (query.includes("Bibendum")) {
      return perplexityPages([{ url: "https://bibendum.example/groupe", title: "Le groupe Bibendum", snippet: "Compagnie Générale des Établissements Bibendum, SIREN 552 100 557." }]);
    }
    // "Weitblick Energie AG" (#172): a web search citing a source by a long URL with no break in it.
    if (query.includes("Weitblick Energie")) {
      return perplexityPages([
        { url: "https://assets.weitblick-energie.example/weitblick/assets/api/uuid:3f1c9a2e-7b4d-4e8a-9c61-2d5f0b8e4a17/251113-press-release-en.pdf", title: "Weitblick Energie AG press release", snippet: "Energy, Germany." },
      ]);
    }
    // "Atlantis Labs" (#95): a web dossier that names no country the people search knows.
    if (query.includes("Atlantis Labs")) {
      return perplexityPages([{ url: "https://atlantis-labs.example/about", title: "Atlantis Labs", snippet: "Robotics, Atlantis." }]);
    }
    return perplexityPages([
      { url: "https://globex-robotics.example/about", title: "About Globex Robotics", snippet: "Industrial robotics, Munich, Germany. 1,200 employees, €300M revenue (2024). CEO: Hans Müller." },
    ]);
  }
  return realFetch(input, init);
};
