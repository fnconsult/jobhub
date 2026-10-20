// Preloaded into the e2e web server (NODE_OPTIONS=--import) to stand in for geo.api.gouv.fr, the
// geolocation Tool behind the Search Criteria's place suggestions (issue #235). Nothing reaches
// the real one. As the real API (docs/research/issue-235.md): `nom` matches the start of any word
// of a name, without case or accents; communes are listed most populated first, up to `limit`.
//
// "loire" finds a commune (Loire-sur-Rhône, 69), two départements (Loire, Loire-Atlantique) and a
// région (Pays de la Loire); "bord" finds Bordeaux (33); "lyo" finds Lyon (69) before
// Lyons-la-Forêt (27); "genève" or "remote" find nothing. A query containing "E2E_GEO_DOWN" gets a 503.
const realFetch = globalThis.fetch;

const communes = [
  { nom: "Lyon", codeDepartement: "69", population: 519127 },
  { nom: "Lyons-la-Forêt", codeDepartement: "27", population: 700 },
  { nom: "Bordeaux", codeDepartement: "33", population: 261804 },
  { nom: "Grenoble", codeDepartement: "38", population: 156389 },
  { nom: "Nantes", codeDepartement: "44", population: 323204 },
  { nom: "Lille", codeDepartement: "59", population: 236710 },
  { nom: "Rennes", codeDepartement: "35", population: 225081 },
  { nom: "Paris", codeDepartement: "75", population: 2102650 },
  { nom: "Loire-sur-Rhône", codeDepartement: "69", population: 2600 },
];
const departements = [
  { nom: "Rhône", code: "69" },
  { nom: "Gironde", code: "33" },
  { nom: "Loire", code: "42" },
  { nom: "Loire-Atlantique", code: "44" },
  { nom: "Paris", code: "75" },
];
const regions = [
  { nom: "Auvergne-Rhône-Alpes", code: "84" },
  { nom: "Île-de-France", code: "11" },
  { nom: "Pays de la Loire", code: "52" },
  { nom: "Nouvelle-Aquitaine", code: "75" },
];

const plain = (text) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
/** Whether a word of `name` starts like `query`. */
const named = (name, query) => plain(name).split(/[\s'-]+/).some((word, index, words) => words.slice(index).join(" ").startsWith(plain(query).replace(/[\s'-]+/g, " ")));

globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
  if (url.origin !== "https://geo.api.gouv.fr") return realFetch(input, init);
  const query = url.searchParams.get("nom") ?? "";
  if (query.includes("E2E_GEO_DOWN")) return new Response("Service Unavailable", { status: 503 });
  const limit = Number(url.searchParams.get("limit") ?? 100);
  if (url.pathname === "/communes") {
    return Response.json(communes.filter((place) => named(place.nom, query)).sort((a, b) => b.population - a.population).slice(0, limit));
  }
  if (url.pathname === "/departements") return Response.json(departements.filter((place) => named(place.nom, query)));
  if (url.pathname === "/regions") return Response.json(regions.filter((place) => named(place.nom, query)));
  return new Response("Not Found", { status: 404 });
};
