// Preloaded into the e2e web server (NODE_OPTIONS=--import) to stand in for the
// contact-data provider behind Enriched Contacts (issue #23): the suite runs
// with CONTACT_ENRICHMENT_PROVIDER=apollo, and Apollo's API is answered here.
// Nothing reaches the real one.
//
// A search at any company finds two made-up people, Claire Martin (DRH) and
// Hugo Bernard (Responsable recrutement). Claire's details reveal a work email;
// Apollo has none for Hugo.
const realFetch = globalThis.fetch;
const API = "https://api.apollo.io/api/v1";
const KEY = "e2e-apollo-key";

const people = [
  { id: "e2e-claire", first_name: "Claire", last_name_obfuscated: "Ma***n", title: "DRH" },
  { id: "e2e-hugo", first_name: "Hugo", last_name_obfuscated: "Be***d", title: "Responsable recrutement" },
];
const details = {
  "e2e-claire": { id: "e2e-claire", name: "Claire Martin", title: "DRH", email: "claire.martin@acme-industrie.example" },
};

globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (`${url.origin}/api/v1` !== API) return realFetch(input, init);
  const headers = new Headers(init?.headers);
  if (headers.get("x-api-key") !== KEY) return Response.json({ error: "Invalid access credentials." }, { status: 401 });
  if (url.pathname === "/api/v1/mixed_people/api_search") return Response.json({ people, total_entries: people.length });
  if (url.pathname === "/api/v1/people/match") {
    const { id } = JSON.parse(init?.body ?? "{}");
    return Response.json({ person: details[id] ?? null });
  }
  return Response.json({ error: "not found" }, { status: 404 });
};
