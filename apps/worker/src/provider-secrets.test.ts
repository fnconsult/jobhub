import { createSecretResolver, type StoredSecrets } from "@jobhub/web/provider-secrets";
import { describe, expect, it, vi } from "vitest";
import { workerClients } from "./provider-secrets";

/** Every AI task on Mistral; web search on Perplexity, whose key env has. */
const ENV = {
  AI_SCORING_PROVIDER: "mistral",
  AI_WRITING_PROVIDER: "mistral",
  AI_COACHING_PROVIDER: "mistral",
  AI_CV_PARSING_PROVIDER: "mistral",
  AI_OFFER_ANALYSIS_PROVIDER: "mistral",
  PERPLEXITY_API_KEY: "perplexity-key-from-env-1234",
};

const MISTRAL_OLD = "mistral-key-old-0123456789";
const MISTRAL_NEW = "mistral-key-new-9876543210";

/** The Provider Secrets the database holds, as the test edits them. */
function database(initial: StoredSecrets = {}) {
  const stored = { current: initial };
  return { stored, resolver: createSecretResolver({ load: async () => stored.current, env: ENV, log: () => {} }) };
}

/** Mistral and France Travail, faked: each request's key is recorded, a revoked one refused (echoed back, as some providers do). */
function fakeProviders() {
  const keysSent: string[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url.startsWith("https://api.mistral.ai/")) {
      const key = request.headers.get("authorization")!.replace("Bearer ", "");
      keysSent.push(key);
      if (key.includes("revoked")) return new Response(JSON.stringify({ message: `Invalid key ${key}` }), { status: 401 });
      return Response.json({ id: "c1", model: "m", choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    }
    if (request.url.includes("francetravail.fr")) {
      const secret = new URLSearchParams(await request.text()).get("client_secret")!;
      keysSent.push(secret);
      if (secret.includes("revoked")) return new Response("{}", { status: 401 });
      return Response.json({ access_token: "token", expires_in: 1500 });
    }
    if (request.url.includes("api.francetravail.io")) return new Response(null, { status: 204 });
    throw new Error(`unexpected ${request.url}`);
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, keysSent };
}

const generate = { task: "scoring" as const, candidateId: "c-1", system: "s", prompt: "p" };

function clients(resolver: ReturnType<typeof database>["resolver"], fetch: typeof globalThis.fetch, lines: string[]) {
  return workerClients({ resolver, production: false, jobOffers: {} as never, fetch, log: (line) => lines.push(line), usage: { record: (entry) => void lines.push(JSON.stringify(entry)) } });
}

describe("the worker's clients, on Provider Secrets (#208)", () => {
  it("turns Job discovery on once its key is entered in the Back Office, without a restart", async () => {
    const { stored, resolver } = database();
    await resolver.refresh();
    const lines: string[] = [];
    const worker = clients(resolver, fakeProviders().fetch, lines);

    expect(worker.discovery()).toEqual({ unavailable: expect.stringContaining("MISTRAL_API_KEY") });
    stored.current = { MISTRAL_API_KEY: { value: MISTRAL_NEW, row: "r1" } };
    await resolver.refresh();

    expect(worker.discovery()).not.toHaveProperty("unavailable");
    expect(worker.discovery()).toHaveProperty("discover");
  });

  it("uses a key replaced in the Back Office for its next AI call", async () => {
    const { stored, resolver } = database({ MISTRAL_API_KEY: { value: MISTRAL_OLD, row: "r1" } });
    await resolver.refresh();
    const providers = fakeProviders();
    const worker = clients(resolver, providers.fetch, []);

    await worker.ai.generate(generate);
    stored.current = { MISTRAL_API_KEY: { value: MISTRAL_NEW, row: "r2" } };
    await resolver.refresh();
    await worker.ai.generate(generate);

    expect(providers.keysSent).toEqual([MISTRAL_OLD, MISTRAL_NEW]);
  });

  it("asks France Travail once more with the credentials just replaced when it refuses the old ones", async () => {
    const { stored, resolver } = database({
      FRANCE_TRAVAIL_CLIENT_ID: { value: "ft-id", row: "r1" },
      FRANCE_TRAVAIL_CLIENT_SECRET: { value: "ft-secret-revoked", row: "r2" },
    });
    await resolver.refresh();
    const providers = fakeProviders();
    const worker = clients(resolver, providers.fetch, []);
    stored.current = { ...stored.current, FRANCE_TRAVAIL_CLIENT_SECRET: { value: "ft-secret-fresh", row: "r3" } };

    const result = await worker.franceTravail()!.search({ targetRole: "DAF", location: "Lyon" }, { max: 10, now: new Date() });

    expect(result).toMatchObject({ ok: true, offers: [] });
    expect(providers.keysSent).toEqual(["ft-secret-revoked", "ft-secret-fresh"]);
  });

  it("France Travail is off without its credentials, and on once they are entered", async () => {
    const { stored, resolver } = database();
    await resolver.refresh();
    const worker = clients(resolver, fakeProviders().fetch, []);

    expect(worker.franceTravail()).toBeNull();
    stored.current = { FRANCE_TRAVAIL_CLIENT_ID: { value: "ft-id", row: "r1" }, FRANCE_TRAVAIL_CLIENT_SECRET: { value: "ft-secret", row: "r2" } };
    await resolver.refresh();

    expect(worker.franceTravail()).not.toBeNull();
  });

  it("logs no secret value: not when discovery is off, a key is refused and retried, nor in AI usage lines", async () => {
    const { stored, resolver } = database();
    await resolver.refresh();
    const lines: string[] = [];
    const providers = fakeProviders();
    const worker = clients(resolver, providers.fetch, lines);
    worker.discovery();
    stored.current = { MISTRAL_API_KEY: { value: "mistral-key-revoked-55555555", row: "r1" } };
    await resolver.refresh();
    worker.discovery();
    const refused = await worker.ai.generate(generate).catch((error: unknown) => error);
    lines.push(String(refused));
    stored.current = { MISTRAL_API_KEY: { value: MISTRAL_NEW, row: "r2" } };
    await worker.ai.generate(generate);

    expect(lines.length).toBeGreaterThan(2);
    for (const value of ["mistral-key-revoked-55555555", MISTRAL_NEW, ENV.PERPLEXITY_API_KEY]) expect(lines.join("\n")).not.toContain(value);
  });
});
