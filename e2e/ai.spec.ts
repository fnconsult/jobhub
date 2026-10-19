import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { HarnessCall, HarnessResult } from "./support/ai-harness";

// The AI layer (issue #3, ADR-0007) has no UI or HTTP route yet: its public entry point is
// `createAiLayerFromEnv()` from "@jobhub/ai", configured only through environment variables.
// Each test boots it in a fresh process with a given environment (see support/ai-harness.ts),
// makes calls, and observes what would leave the process (recorded network requests) and the
// usage lines written to stdout. No real provider is ever contacted.

const tsx = path.resolve("node_modules/.bin/tsx");
const harness = path.resolve("e2e/support/ai-harness.ts");

interface UsageLine {
  event: "ai_usage";
  candidateId: string | null;
  task: string;
  provider: string;
  endpoint: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  at: string;
}

function runAi(env: Record<string, string>, calls: HarnessCall[] = []) {
  // A clean environment: only what the test sets, so no developer key or AWS profile leaks in.
  const result = spawnSync(tsx, [harness, JSON.stringify(calls)], {
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
    encoding: "utf8",
    timeout: 30_000,
  });
  const lines = result.stdout.split("\n");
  const resultLine = lines.find((line) => line.startsWith("AI_HARNESS_RESULT "));
  if (!resultLine) throw new Error(`AI harness failed (exit ${result.status}):\n${result.stdout}\n${result.stderr}`);
  const usage = lines.filter((line) => line.startsWith("{")).map((line) => JSON.parse(line) as UsageLine).filter((l) => l.event === "ai_usage");
  return { stderr: result.stderr, ...(JSON.parse(resultLine.slice("AI_HARNESS_RESULT ".length)) as HarnessResult), usage };
}

const CV = "Jean Dupont, jean.dupont@example.fr, 06 12 34 56 78. Développeur TypeScript, 8 ans d'expérience.";
/** The CV as it leaves for a provider: its email and phone taken out by the guardrail (the harness knows no Candidate's name). */
const REDACTED_CV = "Jean Dupont, [E-MAIL], [TÉLÉPHONE]. Développeur TypeScript, 8 ans d'expérience.";
const score = (candidateId: string | null = "cand-1"): HarnessCall => ({
  kind: "generate",
  task: "scoring",
  candidateId,
  system: "Score this CV against the offer.",
  prompt: CV,
});
const write = (candidateId: string | null = "cand-1"): HarnessCall => ({ kind: "generate", task: "writing", candidateId, prompt: CV });
const analyseOffer: HarnessCall = { kind: "generate", task: "offer_analysis", candidateId: "cand-1", prompt: "Offre : Développeur TS, Paris, CDI." };
const search = (candidateId: string | null = "cand-1", filters?: Record<string, unknown>): HarnessCall => ({
  kind: "search",
  candidateId,
  filters,
  criteria: {
    targetRole: "Développeur TypeScript jean.dupont@example.fr",
    locations: ["Paris +33 6 12 34 56 78"],
    minSalary: 55000,
    contractTypes: ["cdi"],
    remoteWorkOptions: ["hybrid"],
  },
});

/** Keys for every real provider, so each routing below only differs by its AI_*_PROVIDER lines. */
const KEYS = {
  AWS_BEARER_TOKEN_BEDROCK: "test-bedrock-key",
  ANTHROPIC_API_KEY: "test-anthropic-key",
  MISTRAL_API_KEY: "test-mistral-key",
  OPENAI_API_KEY: "test-openai-key",
  PERPLEXITY_API_KEY: "test-perplexity-key",
};

const ok = (r: ReturnType<typeof runAi>) => {
  expect(r.startup).toEqual({ ok: true });
  for (const outcome of r.outcomes) expect(outcome, JSON.stringify(outcome)).toMatchObject({ ok: true });
};

test.describe("AI layer: one module hides the provider, routing is configuration", () => {
  test("the same scoring call goes to whichever provider AI_SCORING_PROVIDER names", () => {
    const hosts: Record<string, string> = {};
    for (const provider of ["anthropic", "mistral", "openai"]) {
      const r = runAi({ ...KEYS, AI_SCORING_PROVIDER: provider }, [score()]);
      ok(r);
      expect(r.requests).toHaveLength(1);
      expect(r.outcomes[0]).toMatchObject({ ok: true, value: { provider } });
      hosts[provider] = r.requests[0]!.host;
    }
    expect(hosts).toEqual({
      anthropic: "bedrock-mantle.eu-west-3.api.aws",
      mistral: "api.mistral.ai",
      openai: "eu.api.openai.com",
    });
  });

  test("each task is routed independently, and AI_<TASK>_MODEL picks the model", () => {
    const r = runAi(
      {
        ...KEYS,
        AI_SCORING_PROVIDER: "mistral",
        AI_SCORING_MODEL: "mistral-small-latest",
        AI_WRITING_PROVIDER: "openai",
        AI_OFFER_ANALYSIS_PROVIDER: "anthropic",
        AI_WEB_SEARCH_PROVIDER: "perplexity",
        AI_WEB_SEARCH_MODEL: "perplexity/sonar",
      },
      [score(), write(), analyseOffer, search()],
    );
    ok(r);
    expect(r.requests.map((req) => req.host)).toEqual([
      "api.mistral.ai",
      "eu.api.openai.com",
      // Both Claude keys: offer analysis, without personal data, takes the direct API.
      "api.anthropic.com",
      "api.perplexity.ai",
    ]);
    expect(JSON.parse(r.requests[0]!.body).model).toBe("mistral-small-latest");
    expect(JSON.parse(r.requests[3]!.body).model).toBe("perplexity/sonar");
    expect(r.outcomes.map((o) => (o.ok ? o.value.provider : o.error.name))).toEqual(["mistral", "openai", "anthropic", "perplexity"]);
  });

  test("with no routing configured, text tasks default to Claude on Bedrock EU and search to Perplexity", () => {
    const r = runAi({ AWS_BEARER_TOKEN_BEDROCK: "test-bedrock-key", PERPLEXITY_API_KEY: "test-perplexity-key" }, [score(), search()]);
    ok(r);
    expect(r.requests.map((req) => req.host)).toEqual(["bedrock-mantle.eu-west-3.api.aws", "api.perplexity.ai"]);
  });
});

test.describe("AI layer: provider adapters", () => {
  test("Anthropic on AWS Bedrock eu-west-3 (the default endpoint)", () => {
    const r = runAi({ AWS_BEARER_TOKEN_BEDROCK: "test-bedrock-key", PERPLEXITY_API_KEY: "p" }, [score()]);
    ok(r);
    const [request] = r.requests;
    expect(request!.url).toBe("https://bedrock-mantle.eu-west-3.api.aws/anthropic/v1/messages");
    const body = JSON.parse(request!.body);
    // The guardrail (ADR-0007, 2026-10-20) took the email and phone out, and told the model so.
    expect(body.system).toMatch(/^Score this CV against the offer\.\n+Note : des données personnelles ont été remplacées/);
    expect(body.messages).toEqual([{ role: "user", content: REDACTED_CV }]);
    expect(r.outcomes[0]).toMatchObject({ ok: true, value: { text: "reply from bedrock-mantle.eu-west-3.api.aws", provider: "anthropic" } });
  });

  test("Anthropic on Vertex AI in an EU location is accepted for personal-data tasks at start-up", () => {
    const r = runAi({ ANTHROPIC_ENDPOINT: "vertex", VERTEX_REGION: "europe-west1", VERTEX_PROJECT_ID: "jobhub-e2e", PERPLEXITY_API_KEY: "p" });
    expect(r.startup).toEqual({ ok: true });
  });

  test("Anthropic direct API, for a task without personal data", () => {
    const r = runAi({ ...KEYS, ANTHROPIC_ENDPOINT: "direct", AI_SCORING_PROVIDER: "mistral", AI_WRITING_PROVIDER: "mistral", AI_COACHING_PROVIDER: "mistral", AI_CV_PARSING_PROVIDER: "mistral" }, [
      analyseOffer,
    ]);
    ok(r);
    expect(r.requests[0]!.url).toBe("https://api.anthropic.com/v1/messages");
    expect(r.requests[0]!.apiKeyHeader).toBe("test-anthropic-key");
  });

  test("Mistral and OpenAI (EU residency) over their chat-completions APIs, Perplexity over its Agent API", () => {
    const r = runAi({ ...KEYS, AI_SCORING_PROVIDER: "mistral", AI_WRITING_PROVIDER: "openai" }, [score(), write(), search()]);
    ok(r);
    expect(r.requests.map((req) => req.url)).toEqual([
      "https://api.mistral.ai/v1/chat/completions",
      "https://eu.api.openai.com/v1/chat/completions",
      "https://api.perplexity.ai/v1/responses",
    ]);
    expect(JSON.parse(r.requests[0]!.body).messages[0]).toMatchObject({ role: "system", content: expect.stringMatching(/^Score this CV against the offer\.\n+Note : /) });
    expect(JSON.parse(r.requests[0]!.body).messages[1]).toEqual({ role: "user", content: REDACTED_CV });
    expect(r.outcomes[2]).toMatchObject({ ok: true, value: { answer: "reply from api.perplexity.ai", sources: ["https://jobs.example/offre-1"] } });
  });
});

test.describe("AI layer: the guardrail, not the endpoint's region, keeps identity in (ADR-0007, 2026-10-20)", () => {
  const outsideEu: [string, Record<string, string>, string][] = [
    ["scoring on the direct Anthropic API", { ANTHROPIC_ENDPOINT: "direct", AI_SCORING_PROVIDER: "anthropic" }, "api.anthropic.com"],
    ["Bedrock outside the EU", { BEDROCK_REGION: "us-east-1", ANTHROPIC_API_KEY: "", ANTHROPIC_ENDPOINT: "bedrock" }, "bedrock-mantle.us-east-1.api.aws"],
    ["OpenAI without EU data residency", { AI_SCORING_PROVIDER: "openai", OPENAI_DATA_RESIDENCY: "us" }, "api.openai.com"],
  ];
  for (const [name, env, host] of outsideEu) {
    test(`starts, and sends a personal-data task without its email or phone: ${name}`, () => {
      const r = runAi({ ...KEYS, ...env }, [score()]);
      ok(r);
      expect(r.requests).toHaveLength(1);
      expect(r.requests[0]!.host).toBe(host);
      expect(r.requests[0]!.body).not.toMatch(/jean\.dupont@example\.fr|06 12 34 56 78/);
      expect(r.requests[0]!.body).toContain("[E-MAIL]");
    });
  }

  test("Vertex outside the EU is accepted at start-up", () => {
    const r = runAi({ ...KEYS, ANTHROPIC_ENDPOINT: "vertex", VERTEX_REGION: "us-east5", VERTEX_PROJECT_ID: "p" });
    expect(r.startup).toEqual({ ok: true });
  });

  test("Perplexity cannot be given a text task (it would receive a CV)", () => {
    const r = runAi({ ...KEYS, AI_WRITING_PROVIDER: "perplexity" }, [write()]);
    expect(r.startup).toMatchObject({ ok: false, error: { name: "AiConfigError" } });
    expect(r.requests).toEqual([]);
  });

  test("a text provider cannot serve web search", () => {
    const r = runAi({ ...KEYS, AI_WEB_SEARCH_PROVIDER: "mistral" });
    expect(r.startup).toMatchObject({ ok: false, error: { name: "AiConfigError" } });
  });

  test("Perplexity only receives a query built from Search Criteria, stripped of contact details", () => {
    const r = runAi(KEYS, [search()]);
    ok(r);
    expect(r.requests).toHaveLength(1);
    const body = JSON.parse(r.requests[0]!.body);
    const query: string = body.input;
    expect(query).toContain("Développeur TypeScript");
    expect(query).toContain("Paris");
    expect(query).toContain("CDI");
    expect(query).toMatch(/55.000 €/);
    expect(query).not.toMatch(/@|jean|dupont|12 34|\+33/i);
    // Nothing but that query and the search settings goes out: no instructions, no other input.
    expect(Object.keys(body).sort()).toEqual(["input", "max_output_tokens", "preset", "store", "tools"]);
  });
});

test.describe("AI layer: keys come from the environment", () => {
  test("each provider's key is read from its environment variable and sent as its credential", () => {
    const r = runAi({ ...KEYS, AI_SCORING_PROVIDER: "mistral", AI_WRITING_PROVIDER: "openai", AI_COACHING_PROVIDER: "anthropic" }, [
      score(),
      write(),
      { kind: "generate", task: "coaching", candidateId: "cand-1", prompt: "Aide-moi." },
      search(),
    ]);
    ok(r);
    expect(r.requests.map((req) => req.authorization)).toEqual([
      "Bearer test-mistral-key",
      "Bearer test-openai-key",
      "Bearer test-bedrock-key",
      "Bearer test-perplexity-key",
    ]);
  });

  for (const [provider, key] of [
    ["mistral", "MISTRAL_API_KEY"],
    ["openai", "OPENAI_API_KEY"],
  ] as const) {
    test(`a missing ${key} stops start-up and names the variable`, () => {
      const env: Record<string, string> = { ...KEYS, AI_SCORING_PROVIDER: provider };
      delete env[key];
      const r = runAi(env, [score()]);
      expect(r.startup).toMatchObject({ ok: false, error: { name: "AiConfigError" } });
      if (!r.startup.ok) expect(r.startup.error.message).toContain(key);
    });
  }

  test("a missing PERPLEXITY_API_KEY stops start-up", () => {
    const r = runAi({ AWS_BEARER_TOKEN_BEDROCK: "b" });
    expect(r.startup).toMatchObject({ ok: false, error: { name: "AiConfigError" } });
    if (!r.startup.ok) expect(r.startup.error.message).toContain("PERPLEXITY_API_KEY");
  });

  test(".env.example lists every key the AI layer reads, with no secret values", () => {
    const listed = spawnSync(tsx, ["-e", 'import("@jobhub/ai").then((m) => console.log(JSON.stringify(m.AI_ENV_KEYS)))'], { encoding: "utf8" });
    const keys = JSON.parse(listed.stdout) as string[];
    expect(keys).toEqual(expect.arrayContaining(Object.keys(KEYS)));
    const example = readFileSync(".env.example", "utf8");
    const entries = new Map(
      example
        .split("\n")
        .filter((line) => /^[A-Z0-9_]+=/.test(line))
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)] as const),
    );
    for (const key of keys) expect(entries.has(key), `${key} missing from .env.example`).toBe(true);
    for (const key of [...keys].filter((k) => /KEY|TOKEN/.test(k))) expect(entries.get(key), `${key} must be empty`).toBe("");
  });
});

test.describe("AI layer: Perplexity's Agent API (issue #74)", () => {
  const recorded = path.resolve("packages/ai/src/providers/fixtures/perplexity-responses-search.json");

  test("a web search answered with a recorded /v1/responses reply returns the answer, sources and usage", () => {
    const r = runAi({ ...KEYS, E2E_PERPLEXITY_REPLY: recorded, AI_WEB_SEARCH_MODEL: "perplexity/sonar" }, [search("cand-74")]);
    ok(r);
    expect(r.requests.map((req) => req.url)).toEqual(["https://api.perplexity.ai/v1/responses"]);
    expect(r.requests[0]!.authorization).toBe("Bearer test-perplexity-key");
    expect(JSON.parse(r.requests[0]!.body)).toMatchObject({ model: "perplexity/sonar", tools: [{ type: "web_search" }] });

    expect(r.outcomes[0]).toMatchObject({
      ok: true,
      value: {
        provider: "perplexity",
        answer:
          "Deux offres de DAF en CDI à Lyon : Acme Industrie [1] et un groupe industriel [2]. Les deux sont publiées depuis moins de deux semaines.",
        // Search results, then the cited pages, each once.
        sources: [
          "https://carrieres.acme-industrie.example/offres/daf-lyon",
          "https://www.cadremploi.example/emploi/daf-lyon-123",
          "https://www.apec.example/offre/daf-lyon-456",
        ],
      },
    });
    expect(r.usage).toEqual([
      expect.objectContaining({ candidateId: "cand-74", task: "web_search", provider: "perplexity", inputTokens: 812, outputTokens: 64 }),
    ]);
  });

  test("a search Perplexity fails surfaces as an error, logged as failed with no tokens (#218)", () => {
    const r = runAi({ ...KEYS }, [{ ...search(), criteria: { ...search().criteria, targetRole: "E2E_PROVIDER_DOWN" } } as HarnessCall]);
    expect(r.startup).toEqual({ ok: true });
    expect(r.outcomes[0]).toMatchObject({ ok: false });
    expect(r.usage).toEqual([expect.objectContaining({ ok: false, inputTokens: 0, outputTokens: 0 })]);
  });
});

test.describe("AI layer: token usage is logged per Candidate", () => {
  test("every call writes one ai_usage line with the Candidate, task, provider and tokens", () => {
    const r = runAi({ ...KEYS, AI_WRITING_PROVIDER: "mistral" }, [score("cand-1"), write("cand-1"), search("cand-2"), score(null)]);
    ok(r);
    expect(r.usage).toHaveLength(4);
    expect(r.usage).toEqual([
      expect.objectContaining({ candidateId: "cand-1", task: "scoring", provider: "anthropic", endpoint: "bedrock eu-west-3", inputTokens: 200, outputTokens: 50 }),
      expect.objectContaining({ candidateId: "cand-1", task: "writing", provider: "mistral", endpoint: "api.mistral.ai", inputTokens: 120, outputTokens: 30 }),
      expect.objectContaining({ candidateId: "cand-2", task: "web_search", provider: "perplexity", inputTokens: 120, outputTokens: 30 }),
      expect.objectContaining({ candidateId: null, task: "scoring", inputTokens: 200, outputTokens: 50 }),
    ]);
    for (const line of r.usage) expect(Number.isNaN(Date.parse(line.at))).toBe(false);

    // Plan Quotas can be computed by summing a Candidate's lines.
    const total = (id: string) =>
      r.usage.filter((l) => l.candidateId === id).reduce((sum, l) => sum + l.inputTokens + l.outputTokens, 0);
    expect(total("cand-1")).toBe(400);
    expect(total("cand-2")).toBe(150);
  });

  test("a failed provider call is reported, and logged as failed with no tokens, so it counts for nothing (#218)", () => {
    const r = runAi({ ...KEYS, AI_SCORING_PROVIDER: "mistral" }, [
      { kind: "generate", task: "scoring", candidateId: "cand-1", prompt: "E2E_PROVIDER_DOWN" },
      score("cand-1"),
    ]);
    expect(r.outcomes[0]).toMatchObject({ ok: false, error: { name: "AiProviderError" } });
    expect(r.outcomes[1]).toMatchObject({ ok: true });
    expect(r.usage).toEqual([
      expect.objectContaining({ candidateId: "cand-1", task: "scoring", ok: false, inputTokens: 0, outputTokens: 0 }),
      expect.objectContaining({ candidateId: "cand-1", task: "scoring", ok: true }),
    ]);
  });
});

test.describe("AI layer: fake provider", () => {
  test("AI_FAKE=true serves every task without keys or network, and still logs usage", () => {
    const r = runAi({ AI_FAKE: "true", AI_SCORING_PROVIDER: "mistral" }, [score(), write(), search()]);
    ok(r);
    expect(r.requests).toEqual([]);
    expect(r.outcomes.map((o) => (o.ok ? (o.value.text ?? o.value.answer) : null))).toEqual(["fake reply", "fake reply", "fake answer"]);
    expect(r.outcomes[0]).toMatchObject({ value: { provider: "mistral" } });
    expect(r.usage.map((l) => l.candidateId)).toEqual(["cand-1", "cand-1", "cand-1"]);
  });

  test("AI_FAKE is refused in production", () => {
    const r = runAi({ AI_FAKE: "true", NODE_ENV: "production" });
    expect(r.startup).toMatchObject({ ok: false, error: { name: "AiConfigError" } });
  });
});

test.describe("AI layer: pluggable web search providers (issue #110)", () => {
  const ACME = "https://carrieres.acme-industrie.example/offres/daf-lyon";
  const CADREMPLOI = "https://www.cadremploi.example/emploi/daf-lyon-123";
  const SEARCH_KEYS = { BRAVE_SEARCH_API_KEY: "test-brave-key", TAVILY_API_KEY: "test-tavily-key", LINKUP_API_KEY: "test-linkup-key" };
  const FILTERS = { includeDomains: ["apec.fr", "cadremploi.fr"], excludeDomains: ["indeed.fr"], maxAgeDays: 30 };
  const route = (provider: string) => ({ ...KEYS, ...SEARCH_KEYS, AI_WEB_SEARCH_PROVIDER: provider });
  const dayOffset = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  for (const provider of ["brave", "tavily", "linkup"]) {
    test(`AI_WEB_SEARCH_PROVIDER=${provider} returns the provider's results as sources, and logs usage`, () => {
      const r = runAi(route(provider), [search("cand-110")]);
      ok(r);
      expect(r.requests).toHaveLength(1);
      expect(r.outcomes[0]).toMatchObject({ ok: true, value: { provider, sources: [ACME, CADREMPLOI] } });
      expect(r.usage).toEqual([expect.objectContaining({ candidateId: "cand-110", task: "web_search", provider, inputTokens: 0, outputTokens: 0 })]);
    });
  }

  test("each adapter calls its own API with its own key", () => {
    const requestOf = (provider: string) => runAi(route(provider), [search()]).requests[0]!;
    const brave = requestOf("brave");
    expect(brave.host).toBe("api.search.brave.com");
    expect(new URL(brave.url).pathname).toBe("/res/v1/web/search");
    expect(requestOf("tavily")).toMatchObject({ url: "https://api.tavily.com/search", authorization: "Bearer test-tavily-key" });
    expect(requestOf("linkup")).toMatchObject({ url: "https://api.linkup.so/v1/search", authorization: "Bearer test-linkup-key" });
  });

  test("Tavily applies domain and date filters as its own parameters", () => {
    const r = runAi(route("tavily"), [search("cand-1", FILTERS)]);
    ok(r);
    expect(JSON.parse(r.requests[0]!.body)).toMatchObject({
      include_domains: ["apec.fr", "cadremploi.fr"],
      exclude_domains: ["indeed.fr"],
      start_date: dayOffset(30),
    });
  });

  test("Linkup applies domain and date filters as its own parameters", () => {
    const r = runAi(route("linkup"), [search("cand-1", FILTERS)]);
    ok(r);
    expect(JSON.parse(r.requests[0]!.body)).toMatchObject({
      includeDomains: ["apec.fr", "cadremploi.fr"],
      excludeDomains: ["indeed.fr"],
      fromDate: dayOffset(30),
    });
  });

  test("Brave turns included domains into site: operators and the freshness into a date range", () => {
    const r = runAi(route("brave"), [search("cand-1", FILTERS)]);
    ok(r);
    const params = new URL(r.requests[0]!.url).searchParams;
    expect(params.get("q")).toMatch(/ site:apec\.fr OR site:cadremploi\.fr$/);
    expect(params.get("freshness")).toBe(`${dayOffset(30)}to${dayOffset(0)}`);
  });

  test("the model setting is the search depth for Tavily and Linkup", () => {
    const tavily = runAi({ ...route("tavily"), AI_WEB_SEARCH_MODEL: "advanced" }, [search()]);
    expect(JSON.parse(tavily.requests[0]!.body).search_depth).toBe("advanced");
    const linkup = runAi({ ...route("linkup"), AI_WEB_SEARCH_MODEL: "deep" }, [search()]);
    expect(JSON.parse(linkup.requests[0]!.body).depth).toBe("deep");
  });

  for (const provider of ["brave", "tavily", "linkup"]) {
    test(`${provider} only receives a query built from Search Criteria, with no contact details`, () => {
      const r = runAi(route(provider), [search()]);
      ok(r);
      const request = r.requests[0]!;
      const sent = decodeURIComponent(request.body + request.url).replace(/\+/g, " ");
      expect(sent).toContain("Développeur TypeScript");
      expect(sent).toContain("Paris");
      expect(sent).not.toMatch(/@|jean|dupont|12 34|\+33/i);
    });

    test(`${provider} cannot be given a text task (it would receive a CV)`, () => {
      const r = runAi({ ...route(provider), AI_WRITING_PROVIDER: provider }, [write()]);
      expect(r.startup).toMatchObject({ ok: false, error: { name: "AiConfigError" } });
      expect(r.requests).toEqual([]);
    });

    test(`a failing ${provider} search is reported, and logged as failed with no tokens (#218)`, () => {
      const r = runAi(route(provider), [{ ...search(), criteria: { ...search().criteria, targetRole: "E2E_PROVIDER_DOWN" } } as HarnessCall]);
      expect(r.startup).toEqual({ ok: true });
      expect(r.outcomes[0]).toMatchObject({ ok: false, error: { name: "AiProviderError" } });
      expect(r.usage).toEqual([expect.objectContaining({ ok: false, inputTokens: 0, outputTokens: 0 })]);
    });
  }

  for (const [provider, key] of [
    ["brave", "BRAVE_SEARCH_API_KEY"],
    ["tavily", "TAVILY_API_KEY"],
    ["linkup", "LINKUP_API_KEY"],
  ] as const) {
    test(`a missing ${key} stops start-up and names the variable`, () => {
      const env: Record<string, string> = { ...route(provider) };
      delete env[key];
      const r = runAi(env);
      expect(r.startup).toMatchObject({ ok: false, error: { name: "AiConfigError" } });
      if (!r.startup.ok) expect(r.startup.error.message).toContain(key);
    });
  }

  test("a provider's key is only needed when it serves the task", () => {
    expect(runAi({ ...KEYS }).startup).toEqual({ ok: true });
  });

  test("AI_ENV_KEYS and .env.example list the three adapter keys, empty", () => {
    const listed = spawnSync(tsx, ["-e", 'import("@jobhub/ai").then((m) => console.log(JSON.stringify(m.AI_ENV_KEYS)))'], { encoding: "utf8" });
    const keys = JSON.parse(listed.stdout) as string[];
    const example = readFileSync(".env.example", "utf8");
    for (const key of Object.keys(SEARCH_KEYS)) {
      expect(keys).toContain(key);
      expect(example).toMatch(new RegExp(`^${key}=$`, "m"));
    }
    expect(example).toMatch(/^AI_WEB_SEARCH_PROVIDER=/m);
  });

  test("the live recorder does nothing without WEB_SEARCH_LIVE, so CI never calls a provider", () => {
    const result = spawnSync("npx", ["vitest", "run", "packages/ai/src/providers/web-search.live.test.ts"], {
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", BRAVE_SEARCH_API_KEY: "k", TAVILY_API_KEY: "k", LINKUP_API_KEY: "k" },
      encoding: "utf8",
      timeout: 55_000,
    });
    const out = result.stdout + result.stderr;
    expect(result.status, out).toBe(0);
    expect(out).toMatch(/skipped/);
    expect(out).not.toMatch(/\d+ passed/);
  });
});

// Issue #121 (ADR-0007 amendment): identity-bearing AI calls of a Candidate with EU AI consent go to Mistral.
test.describe("AI layer: identity routing under EU AI consent (issue #121)", () => {
  const routing = { ...KEYS, AI_WRITING_PROVIDER: "anthropic", AI_COACHING_PROVIDER: "anthropic", E2E_EU_AI_CONSENT: "cand-consenting" };
  const letter = (candidateId: string, containsIdentity?: boolean, prompt = "Lettre signée Marie Dupont"): HarnessCall => ({
    kind: "generate",
    task: "writing",
    candidateId,
    prompt,
    containsIdentity,
  });

  test("consent and identity: the call goes to Mistral, and usage says so", () => {
    const r = runAi(routing, [letter("cand-consenting", true)]);
    ok(r);
    expect(r.requests.map((req) => req.host)).toEqual(["api.mistral.ai"]);
    expect(r.usage).toEqual([expect.objectContaining({ candidateId: "cand-consenting", task: "writing", provider: "mistral" })]);
  });

  test("AI_IDENTITY_MODEL picks the model of the identity route", () => {
    const r = runAi({ ...routing, AI_IDENTITY_MODEL: "mistral-e2e-model" }, [letter("cand-consenting", true)]);
    ok(r);
    expect(JSON.parse(r.requests[0]!.body).model).toBe("mistral-e2e-model");
  });

  test("consent but no identity: the task's configured provider", () => {
    const r = runAi(routing, [letter("cand-consenting", false, "Résume cette offre : DAF H/F à Lyon")]);
    ok(r);
    expect(r.requests.map((req) => req.host)).toEqual(["bedrock-mantle.eu-west-3.api.aws"]);
    expect(r.usage[0]).toMatchObject({ provider: "anthropic" });
  });

  test("no consent: the task's configured provider, even with identity", () => {
    const r = runAi(routing, [letter("cand-other", true)]);
    ok(r);
    expect(r.requests.map((req) => req.host)).toEqual(["bedrock-mantle.eu-west-3.api.aws"]);
    expect(r.usage[0]).toMatchObject({ provider: "anthropic" });
  });

  test("an undeclared phone number is found: the call goes to Mistral and the hit is logged without the prompt", () => {
    const prompt = "Rappelez-moi au 06 12 34 56 78 pour ma candidature";
    const r = runAi(routing, [{ kind: "generate", task: "coaching", candidateId: "cand-consenting", prompt }]);
    ok(r);
    expect(r.requests.map((req) => req.host)).toEqual(["api.mistral.ai"]);
    expect(r.usage[0]).toMatchObject({ provider: "mistral", task: "coaching" });
    expect(r.stderr).toMatch(/undeclared identity/i);
    expect(r.stderr).toContain("cand-consenting");
    expect(r.stderr).toContain("phone");
    expect(r.stderr).not.toContain("06 12 34 56 78");
  });

  test("an undeclared phone number without consent is not rerouted", () => {
    const r = runAi(routing, [{ kind: "generate", task: "coaching", candidateId: "cand-other", prompt: "Appelez le 06 12 34 56 78" }]);
    ok(r);
    expect(r.requests.map((req) => req.host)).toEqual(["bedrock-mantle.eu-west-3.api.aws"]);
    expect(r.stderr).not.toMatch(/undeclared identity/i);
  });
});
