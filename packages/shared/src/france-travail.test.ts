import { describe, expect, it } from "vitest";
import { checkFranceTravailAccess, createFranceTravailTokens, FRANCE_TRAVAIL_TOKEN_URL } from "./france-travail";

const NOW = new Date("2026-10-26T10:00:00Z");

/**
 * France Travail's token endpoint as francetravail.io documents it: a client with an id and
 * secret, granted some scopes; a request naming any scope not granted fails as a whole with
 * 400 invalid_scope, a wrong secret with 400 invalid_client.
 */
function fakeTokenEndpoint({ granted, secret = "secret", answer }: { granted: string[]; secret?: string; answer?: () => Response | null }) {
  const scopesAsked: string[] = [];
  let issued = 0;
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    expect(request.url).toBe(FRANCE_TRAVAIL_TOKEN_URL);
    const form = new URLSearchParams(await request.text());
    scopesAsked.push(form.get("scope") ?? "");
    const forced = answer?.();
    if (forced) return forced;
    if (form.get("client_id") !== "id" || form.get("client_secret") !== secret) {
      return Response.json({ error: "invalid_client", error_description: "Client authentication failed" }, { status: 400 });
    }
    const unknown = (form.get("scope") ?? "").split(" ").filter((scope) => !granted.includes(scope));
    if (unknown.length > 0) return Response.json({ error: "invalid_scope", error_description: `Unknown/invalid scope(s): [${unknown.join(", ")}]` }, { status: 400 });
    issued++;
    return Response.json({ access_token: `token-${issued}`, token_type: "Bearer", expires_in: 1499, scope: form.get("scope") });
  }) as typeof globalThis.fetch;
  return { fetch, scopesAsked };
}

/** A client granted La Bonne Boite and ROMEO, not Offres d'emploi (withdrawn for new applications, #385). */
const WITHOUT_OFFRES = ["api_labonneboitev2", "search", "office", "api_romeov2"];

describe("France Travail tokens: one per API, each with only its own scopes", () => {
  it("invalid_scope on Offres d'emploi no longer fails La Bonne Boite's token", async () => {
    const server = fakeTokenEndpoint({ granted: WITHOUT_OFFRES });
    const tokens = createFranceTravailTokens({ clientId: "id", clientSecret: "secret", fetch: server.fetch });

    expect(await tokens.token("offres_emploi", NOW)).toMatchObject({ ok: false, reason: "refused", detail: expect.stringContaining("invalid_scope") });
    expect(await tokens.token("la_bonne_boite", NOW)).toMatchObject({ ok: true, value: expect.stringMatching(/^token-/) });
    expect(await tokens.token("romeo", NOW)).toMatchObject({ ok: true });

    // Never one API's scopes in another's request.
    expect(server.scopesAsked).toEqual(["api_offresdemploiv2 o2dsoffre", "api_labonneboitev2 search office", "api_romeov2"]);
  });

  it("La Bonne Boite: without search and office granted, asks api_labonneboitev2 alone, and keeps to what worked", async () => {
    const server = fakeTokenEndpoint({ granted: ["api_labonneboitev2"] });
    const tokens = createFranceTravailTokens({ clientId: "id", clientSecret: "secret", fetch: server.fetch });

    expect(await tokens.token("la_bonne_boite", NOW)).toEqual({ ok: true, value: "token-1", calls: 2 });
    tokens.forget("la_bonne_boite");
    expect(await tokens.token("la_bonne_boite", NOW)).toEqual({ ok: true, value: "token-2", calls: 1 });

    expect(server.scopesAsked).toEqual(["api_labonneboitev2 search office", "api_labonneboitev2", "api_labonneboitev2"]);
  });

  it("a client the endpoint does not know is client_invalid, without trying other scopes", async () => {
    const server = fakeTokenEndpoint({ granted: WITHOUT_OFFRES, secret: "another" });
    const tokens = createFranceTravailTokens({ clientId: "id", clientSecret: "secret", fetch: server.fetch });

    expect(await tokens.token("la_bonne_boite", NOW)).toEqual({ ok: false, reason: "client_invalid", detail: "token refused (HTTP 400 invalid_client)", calls: 1 });
    expect(server.scopesAsked).toHaveLength(1);
  });

  it.each([
    ["the endpoint fails", () => new Response("down", { status: 503 }), "token answered 503"],
    ["the answer has no token", () => Response.json({}), "token answer without access_token"],
  ])("%s: failed", async (_, answer, detail) => {
    const server = fakeTokenEndpoint({ granted: WITHOUT_OFFRES, answer });
    const tokens = createFranceTravailTokens({ clientId: "id", clientSecret: "secret", fetch: server.fetch });

    expect(await tokens.token("romeo", NOW)).toEqual({ ok: false, reason: "failed", detail, calls: 1 });
  });

  it("a network error is failed, and never throws", async () => {
    const fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof globalThis.fetch;

    expect(await createFranceTravailTokens({ clientId: "id", clientSecret: "secret", fetch }).token("romeo", NOW)).toMatchObject({
      ok: false,
      reason: "failed",
      detail: expect.stringContaining("fetch failed"),
    });
  });

  it("keeps each API's token apart until a minute before it expires", async () => {
    const server = fakeTokenEndpoint({ granted: WITHOUT_OFFRES });
    const tokens = createFranceTravailTokens({ clientId: "id", clientSecret: "secret", fetch: server.fetch });

    const romeo = await tokens.token("romeo", NOW);
    const bonneBoite = await tokens.token("la_bonne_boite", NOW);
    expect(await tokens.token("romeo", new Date(NOW.getTime() + 1_400_000))).toEqual({ ok: true, value: (romeo as { value: string }).value, calls: 0 });
    expect(bonneBoite).not.toEqual(romeo);
    expect(await tokens.token("romeo", new Date(NOW.getTime() + 1_440_000))).toMatchObject({ ok: true, calls: 1 });
    expect(server.scopesAsked).toEqual(["api_romeov2", "api_labonneboitev2 search office", "api_romeov2"]);
  });
});

describe("checking a France Travail client's access: the client with La Bonne Boite, then each API", () => {
  it("a client lacking Offres d'emploi is valid: La Bonne Boite and ROMEO ok, Offres d'emploi refused", async () => {
    const server = fakeTokenEndpoint({ granted: WITHOUT_OFFRES });

    expect(await checkFranceTravailAccess(createFranceTravailTokens({ clientId: "id", clientSecret: "secret", fetch: server.fetch }), NOW)).toEqual({
      client: "valid",
      apis: { la_bonne_boite: "ok", offres_emploi: "refused", romeo: "ok" },
      detail: expect.stringContaining("offres_emploi: token refused (HTTP 400 invalid_scope)"),
    });
    expect(server.scopesAsked[0]).toBe("api_labonneboitev2 search office");
  });

  it("a client the endpoint does not know is invalid, and no other API is tried", async () => {
    const server = fakeTokenEndpoint({ granted: WITHOUT_OFFRES, secret: "another" });

    expect(await checkFranceTravailAccess(createFranceTravailTokens({ clientId: "id", clientSecret: "secret", fetch: server.fetch }), NOW)).toEqual({
      client: "invalid",
      apis: { la_bonne_boite: "error", offres_emploi: "error", romeo: "error" },
      detail: "token refused (HTTP 400 invalid_client)",
    });
    expect(server.scopesAsked).toHaveLength(1);
  });

  it("an API whose token endpoint fails is in error; the client is valid when any API gave a token", async () => {
    let call = 0;
    const server = fakeTokenEndpoint({ granted: ["api_offresdemploiv2", "o2dsoffre"], answer: () => (++call === 4 ? new Response("down", { status: 502 }) : null) });

    expect(await checkFranceTravailAccess(createFranceTravailTokens({ clientId: "id", clientSecret: "secret", fetch: server.fetch }), NOW)).toEqual({
      client: "valid",
      apis: { la_bonne_boite: "refused", offres_emploi: "ok", romeo: "error" },
      detail: expect.stringContaining("romeo: token answered 502"),
    });
  });

  it("no API granted: the client cannot be told valid", async () => {
    const server = fakeTokenEndpoint({ granted: [] });

    expect(await checkFranceTravailAccess(createFranceTravailTokens({ clientId: "id", clientSecret: "secret", fetch: server.fetch }), NOW)).toMatchObject({
      client: "unknown",
      apis: { la_bonne_boite: "refused", offres_emploi: "refused", romeo: "refused" },
    });
  });
});
