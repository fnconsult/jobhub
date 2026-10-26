// Preloaded into the e2e web server (NODE_OPTIONS=--import) to stand in for France Travail's
// OAuth2 token endpoint, which the Clés section's connection test calls (#400). Shaped as
// francetravail.io documents it (docs/research/issue-400.md): a request naming any scope the
// client is not granted fails as a whole with 400 invalid_scope, an unknown client or a wrong
// secret with 400 invalid_client. Nothing reaches the real one.
//
// One client, e2e-ft-no-offres (secret e2e-ft-secret), as a new francetravail.io application is
// today: granted La Bonne Boite (`api_labonneboitev2` alone, not `search office`) and ROMEO, not
// Offres d'emploi, withdrawn for new applications.
const realFetch = globalThis.fetch;
const TOKEN_URL = "https://entreprise.francetravail.fr/connexion/oauth2/access_token";
const CLIENTS = { "e2e-ft-no-offres": { secret: "e2e-ft-secret", granted: ["api_labonneboitev2", "api_romeov2"] } };

globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (`${url.origin}${url.pathname}` !== TOKEN_URL) return realFetch(input, init);
  const form = new URLSearchParams(init?.body !== undefined ? String(init.body) : input instanceof Request ? await input.text() : "");
  const client = CLIENTS[form.get("client_id") ?? ""];
  if (form.get("grant_type") !== "client_credentials" || !client || client.secret !== form.get("client_secret")) {
    return Response.json({ error: "invalid_client", error_description: "Client authentication failed" }, { status: 400 });
  }
  const unknown = (form.get("scope") ?? "").split(" ").filter((scope) => scope && !client.granted.includes(scope));
  if (unknown.length > 0) return Response.json({ error: "invalid_scope", error_description: `Unknown/invalid scope(s): [${unknown.join(", ")}]` }, { status: 400 });
  return Response.json({ access_token: `e2e-ft-token-${Date.now()}`, token_type: "Bearer", expires_in: 1499, scope: form.get("scope") });
};
