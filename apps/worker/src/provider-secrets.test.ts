import { createPlatformSettingsResolver, type StoredPlatformSettings } from "@jobhub/web/platform-settings";
import { createSecretResolver, type StoredSecrets } from "@jobhub/web/provider-secrets";
import type { UsageEntry } from "@jobhub/ai";
import type { ExternalApiCall } from "@jobhub/shared";
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
function database(initial: StoredSecrets = {}, env: Record<string, string> = ENV) {
  const stored = { current: initial };
  return { stored, resolver: createSecretResolver({ load: async () => stored.current, env, log: () => {} }) };
}

/** Mistral and France Travail, faked: each request's key is recorded, a revoked one refused (echoed back, as some providers do). */
function fakeProviders() {
  const keysSent: string[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url.startsWith("https://api.eu.mistral.ai/")) {
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
    if (request.url.startsWith("https://data.fantastic.jobs/")) {
      const key = request.headers.get("authorization")!.replace("Bearer ", "");
      keysSent.push(key);
      if (key.includes("revoked")) return new Response(JSON.stringify({ message: "Invalid API key" }), { status: 401 });
      return new Response("[]", { headers: { "content-type": "application/json", "x-api-jobs-this-request": "2" } });
    }
    throw new Error(`unexpected ${request.url}`);
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, keysSent };
}

const generate = { task: "scoring" as const, candidateId: "c-1", system: "s", prompt: "p" };

function clients(resolver: ReturnType<typeof database>["resolver"], fetch: typeof globalThis.fetch, lines: string[]) {
  return workerClients({ resolver, production: false, jobOffers: {} as never, fetch, log: (line) => lines.push(line), usage: { record: (entry) => void lines.push(JSON.stringify(entry)) } });
}

describe("the worker's clients, on Provider Secrets (#208)", () => {
  it("keeps Job discovery on without its web search's key, said in the log, and searches once the key is entered, without a restart (#399)", async () => {
    const withoutSearchKey = Object.fromEntries(Object.entries(ENV).filter(([name]) => name !== "PERPLEXITY_API_KEY"));
    const { stored, resolver } = database({ MISTRAL_API_KEY: { value: MISTRAL_OLD, row: "r1" } }, withoutSearchKey);
    await resolver.refresh();
    const lines: string[] = [];
    const worker = clients(resolver, fakeProviders().fetch, lines);

    expect(worker.discovery()).toHaveProperty("discover");
    expect(lines.join("\n")).toContain("without the web search");
    stored.current = { ...stored.current, PERPLEXITY_API_KEY: { value: "perplexity-key-entered-5678", row: "r2" } };
    await resolver.refresh();
    lines.length = 0;

    expect(worker.discovery()).toHaveProperty("discover");
    expect(lines.join("\n")).not.toContain("without the web search");
  });

  it("keeps Job discovery on while a text task's provider waits for its key: that task's calls fail as key_missing (ADR-0042)", async () => {
    const { resolver } = database();
    await resolver.refresh();
    const lines: string[] = [];
    const worker = clients(resolver, fakeProviders().fetch, lines);

    expect(worker.discovery()).toHaveProperty("discover");
    await expect(worker.ai.generate(generate)).rejects.toThrow(/MISTRAL_API_KEY/);
    expect(lines.map((line) => (line.startsWith("{") ? JSON.parse(line) : line))).toContainEqual(expect.objectContaining({ task: "scoring", outcome: "failed", reason: "key_missing" }));
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

    const result = await worker.franceTravail()!.search({ targetRole: "DAF", locations: ["Lyon"], contractTypes: [], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] }, { max: 10, now: new Date() });

    expect(result).toMatchObject({ ok: true, offers: [] });
    expect(providers.keysSent).toEqual(["ft-secret-revoked", "ft-secret-fresh"]);
  });

  it("records each France Travail call as an external API call, at no cost, without its payload or credentials (#218)", async () => {
    const { resolver } = database({ FRANCE_TRAVAIL_CLIENT_ID: { value: "ft-id", row: "r1" }, FRANCE_TRAVAIL_CLIENT_SECRET: { value: "ft-secret-0123456789", row: "r2" } });
    await resolver.refresh();
    const calls: ExternalApiCall[] = [];
    const worker = workerClients({ resolver, production: false, jobOffers: {} as never, fetch: fakeProviders().fetch, externalApis: { record: (call) => void calls.push(call) } });

    await worker.franceTravail()!.search({ targetRole: "DAF", locations: ["Lyon"], contractTypes: [], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] }, { max: 10, now: new Date() });

    expect(calls.map(({ provider, ok, httpStatus, costEur }) => ({ provider, ok, httpStatus, costEur }))).toEqual([
      { provider: "france_travail", ok: true, httpStatus: 200, costEur: 0 },
      { provider: "france_travail", ok: true, httpStatus: 204, costEur: 0 },
    ]);
    expect(JSON.stringify(calls)).not.toMatch(/ft-secret|ft-id|DAF|Lyon/);
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

  describe("Fantastic.jobs, on its Provider Secret FANTASTIC_JOBS_API_KEY (#243)", () => {
    const search = (worker: ReturnType<typeof workerClients>) =>
      worker.fantasticJobs()!.search({ targetRole: "DAF", locations: ["Lyon"], contractTypes: [], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] }, { max: 10, now: new Date() });

    it("uses the key entered in the Back Office over the environment's", async () => {
      const { resolver } = database({ FANTASTIC_JOBS_API_KEY: { value: "fj-key-back-office-0123", row: "r1" } }, { ...ENV, FANTASTIC_JOBS_API_KEY: "fj-key-env-0123456789" });
      await resolver.refresh();
      const providers = fakeProviders();

      expect(await search(clients(resolver, providers.fetch, []))).toMatchObject({ ok: true, offers: [] });
      expect(providers.keysSent).toEqual(["fj-key-back-office-0123"]);
    });

    it("falls back on the environment's key while none is entered in the Back Office", async () => {
      const { resolver } = database({}, { ...ENV, FANTASTIC_JOBS_API_KEY: "fj-key-env-0123456789" });
      await resolver.refresh();
      const providers = fakeProviders();

      await search(clients(resolver, providers.fetch, []));

      expect(providers.keysSent).toEqual(["fj-key-env-0123456789"]);
    });

    it("is off without its key, and on once it is entered, without a restart", async () => {
      const { stored, resolver } = database();
      await resolver.refresh();
      const worker = clients(resolver, fakeProviders().fetch, []);

      expect(worker.fantasticJobs()).toBeNull();
      stored.current = { FANTASTIC_JOBS_API_KEY: { value: "fj-key-0123456789", row: "r1" } };
      await resolver.refresh();

      expect(worker.fantasticJobs()).not.toBeNull();
    });

    it("asks once more with the key just replaced when Fantastic.jobs rejects the old one", async () => {
      const { stored, resolver } = database({ FANTASTIC_JOBS_API_KEY: { value: "fj-key-revoked-0123", row: "r1" } });
      await resolver.refresh();
      const providers = fakeProviders();
      const worker = clients(resolver, providers.fetch, []);
      stored.current = { FANTASTIC_JOBS_API_KEY: { value: "fj-key-fresh-0123456", row: "r2" } };

      expect(await search(worker)).toMatchObject({ ok: true });
      expect(providers.keysSent).toEqual(["fj-key-revoked-0123", "fj-key-fresh-0123456"]);
    });

    it("records each call as an external API call, with the estimated cost of the jobs charged, without its query or key (#218)", async () => {
      const { resolver } = database({ FANTASTIC_JOBS_API_KEY: { value: "fj-key-0123456789", row: "r1" } });
      await resolver.refresh();
      const calls: ExternalApiCall[] = [];
      const worker = workerClients({ resolver, production: false, jobOffers: {} as never, fetch: fakeProviders().fetch, externalApis: { record: (call) => void calls.push(call) } });

      await search(worker);

      expect(calls.map(({ provider, operation, ok, httpStatus, costEur }) => ({ provider, operation, ok, httpStatus, costEur }))).toEqual([
        { provider: "fantastic_jobs", operation: "GET /v1/active-ats", ok: true, httpStatus: 200, costEur: 0.016 },
      ]);
      expect(JSON.stringify(calls)).not.toMatch(/fj-key|DAF|Lyon/);
    });
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

describe("the worker's web search, on the Search provider's Provider Secret (#399)", () => {
  /** Web search on Brave, whose key neither env nor the database has yet. */
  const BRAVE_ENV = { ...ENV, PERPLEXITY_API_KEY: "", AI_WEB_SEARCH_PROVIDER: "brave", MISTRAL_API_KEY: MISTRAL_NEW };
  const BRAVE_KEY = "brave-key-from-back-office-42";
  const criteria = { targetRole: "DAF", locations: ["Lyon"], contractTypes: [], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] };

  it("keeps Job discovery on without it: web search alone is unavailable", async () => {
    const { resolver } = database({}, BRAVE_ENV);
    await resolver.refresh();
    const lines: string[] = [];
    const worker = clients(resolver, fakeProviders().fetch, lines);

    expect(worker.discovery()).toHaveProperty("discover");
    expect(lines).toContain("[worker] Job discovery runs without the web search: its Search provider's key is not set");
    expect(lines.join("\n")).not.toContain("Job discovery is unavailable");
    expect(worker.ai.webSearchAvailable()).toBe(false);
    await expect(worker.ai.searchWeb({ candidateId: "c-1", criteria })).rejects.toThrow(/BRAVE_SEARCH_API_KEY/);
    await expect(worker.ai.generate(generate)).resolves.toMatchObject({ text: "ok" });
  });

  it("uses the key entered in the Back Office for its next search, without a restart", async () => {
    const { stored, resolver } = database({}, BRAVE_ENV);
    await resolver.refresh();
    const sent: string[] = [];
    const providers = fakeProviders();
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      if (!request.url.startsWith("https://api.search.brave.com/")) return providers.fetch(input, init);
      sent.push(request.headers.get("x-subscription-token")!);
      return Response.json({ web: { results: [{ url: "https://emplois.example.fr/daf", title: "DAF", description: "DAF à Lyon" }] } });
    }) as typeof globalThis.fetch;
    const worker = clients(resolver, fetch, []);
    expect(worker.ai.webSearchAvailable()).toBe(false);

    stored.current = { BRAVE_SEARCH_API_KEY: { value: BRAVE_KEY, row: "r1" } };
    await resolver.refresh();

    expect(worker.ai.webSearchAvailable()).toBe(true);
    const found = await worker.ai.searchWeb({ candidateId: "c-1", criteria });
    expect(found.sources).toEqual(["https://emplois.example.fr/daf"]);
    expect(sent).toEqual([BRAVE_KEY]);
  });
});

describe("the worker's AI layer, on the AI routing Platform Settings (#301)", () => {
  it("routes the next AI call as the Back Office set it, without a restart; env's routing while it sets nothing", async () => {
    const { resolver } = database({ MISTRAL_API_KEY: { value: MISTRAL_NEW, row: "r1" } });
    const stored: { current: StoredPlatformSettings } = { current: {} };
    const settings = createPlatformSettingsResolver({ load: async () => stored.current, env: ENV, log: () => {} });
    await Promise.all([resolver.refresh(), settings.refresh()]);
    const asked: string[] = [];
    const { fetch } = fakeProviders();
    const asking = (async (input: string | URL | Request, init?: RequestInit) => {
      asked.push(JSON.parse(String(init?.body)).model);
      return fetch(input, init);
    }) as typeof globalThis.fetch;
    const worker = workerClients({ resolver, platformSettings: settings, production: false, jobOffers: {} as never, fetch: asking, usage: { record: () => {} } });

    await worker.ai.generate(generate);
    stored.current = { AI_SCORING_MODEL: { value: "mistral-small-latest", updatedBy: "ops@jobbbox.ai", updatedAt: new Date() } };
    await settings.refresh();
    await worker.ai.generate(generate);

    expect(asked).toEqual(["mistral-large-latest", "mistral-small-latest"]);
    });
  });

describe("the worker's AI layer, on the prices of Paramètres (#403)", () => {
  it("records the next call at a price overridden in the Back Office, without a restart", async () => {
    const { resolver } = database({ MISTRAL_API_KEY: { value: MISTRAL_NEW, row: "r1" } });
    const stored: { current: StoredPlatformSettings } = { current: {} };
    const settings = createPlatformSettingsResolver({ load: async () => stored.current, env: ENV, log: () => {} });
    await Promise.all([resolver.refresh(), settings.refresh()]);
    const fetch = (async () => Response.json({ results: [{ url: "https://acme.example/", title: "Acme" }] })) as unknown as typeof globalThis.fetch;
    const recorded: UsageEntry[] = [];
    const worker = workerClients({ resolver, platformSettings: settings, production: false, jobOffers: {} as never, fetch, usage: { record: (entry) => void recorded.push(entry) } });

    await worker.ai.searchCompany({ candidateId: null, employer: "Acme" });
    stored.current = { PERPLEXITY_FAST_SEARCH_PRICE_USD: { value: "0.004", updatedBy: "ops@jobbbox.ai", updatedAt: new Date() } };
    await settings.refresh();
    await worker.ai.searchCompany({ candidateId: null, employer: "Acme" });

    expect(recorded.map((entry) => entry.tools[0]?.costEur)).toEqual([expect.closeTo(0.001 * 0.86, 12), expect.closeTo(0.004 * 0.86, 12)]);
  });
});

describe("the worker's mailer, on Provider Secrets and Platform Settings (#300)", () => {
  it("sends its next email (a Job Digest) as the MAIL_FROM saved on Paramètres, without a restart", async () => {
    const env = { ...ENV, BREVO_API_KEY: "xkeysib-env", MAIL_FROM: "Jobbbox <bonjour@jobbbox.fr>" };
    const { resolver } = database({}, env);
    const saved: { current: StoredPlatformSettings } = { current: {} };
    const settings = createPlatformSettingsResolver({ load: async () => saved.current, env, log: () => {} });
    await Promise.all([resolver.refresh(), settings.refresh()]);
    const senders: unknown[] = [];
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_, init) => {
      senders.push(JSON.parse(init!.body as string).sender);
      return new Response("{}", { status: 201 });
    });
    try {
      const worker = workerClients({ resolver, platformSettings: settings, production: false, jobOffers: {} as never, fetch: fakeProviders().fetch });
      const digest = { to: "marie.dupont@example.fr", subject: "Votre Job Digest", text: "3 offres" };

      await worker.mailer.send(digest);
      saved.current = { MAIL_FROM: { value: "Jobbbox <hello@jobbbox.ai>", updatedBy: "ops@jobbbox.ai", updatedAt: new Date() } };
      await settings.refresh();
      await worker.mailer.send(digest);
    } finally {
      fetch.mockRestore();
    }

    expect(senders).toEqual([
      { name: "Jobbbox", email: "bonjour@jobbbox.fr" },
      { name: "Jobbbox", email: "hello@jobbbox.ai" },
    ]);
  });
});
