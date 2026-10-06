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
  return { ...(JSON.parse(resultLine.slice("AI_HARNESS_RESULT ".length)) as HarnessResult), usage };
}

const CV = "Jean Dupont, jean.dupont@example.fr, 06 12 34 56 78. Développeur TypeScript, 8 ans d'expérience.";
const score = (candidateId: string | null = "cand-1"): HarnessCall => ({
  kind: "generate",
  task: "scoring",
  candidateId,
  system: "Score this CV against the offer.",
  prompt: CV,
});
const write = (candidateId: string | null = "cand-1"): HarnessCall => ({ kind: "generate", task: "writing", candidateId, prompt: CV });
const analyseOffer: HarnessCall = { kind: "generate", task: "offer_analysis", candidateId: "cand-1", prompt: "Offre : Développeur TS, Paris, CDI." };
const search = (candidateId: string | null = "cand-1"): HarnessCall => ({
  kind: "search",
  candidateId,
  criteria: {
    targetRole: "Développeur TypeScript jean.dupont@example.fr",
    location: "Paris +33 6 12 34 56 78",
    minSalary: 55000,
    contractType: "cdi",
    remoteWork: "hybrid",
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
        AI_WEB_SEARCH_MODEL: "sonar-pro",
      },
      [score(), write(), analyseOffer, search()],
    );
    ok(r);
    expect(r.requests.map((req) => req.host)).toEqual([
      "api.mistral.ai",
      "eu.api.openai.com",
      "bedrock-mantle.eu-west-3.api.aws",
      "api.perplexity.ai",
    ]);
    expect(JSON.parse(r.requests[0]!.body).model).toBe("mistral-small-latest");
    expect(JSON.parse(r.requests[3]!.body).model).toBe("sonar-pro");
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
    expect(body.system).toBe("Score this CV against the offer.");
    expect(body.messages).toEqual([{ role: "user", content: CV }]);
    expect(r.outcomes[0]).toMatchObject({ ok: true, value: { text: "reply from bedrock-mantle.eu-west-3.api.aws", provider: "anthropic" } });
  });

  test("Anthropic on Vertex AI in an EU location is accepted for personal-data tasks at start-up", () => {
    const r = runAi({ ANTHROPIC_ENDPOINT: "vertex", VERTEX_REGION: "europe-west1", VERTEX_PROJECT_ID: "jobhub-e2e", PERPLEXITY_API_KEY: "p" });
    expect(r.startup).toEqual({ ok: true });
  });

  test("Anthropic direct API, for a task without personal data", () => {
    const r = runAi({ ...KEYS, ANTHROPIC_ENDPOINT: "direct", AI_SCORING_PROVIDER: "mistral", AI_WRITING_PROVIDER: "mistral", AI_COACHING_PROVIDER: "mistral" }, [
      analyseOffer,
    ]);
    ok(r);
    expect(r.requests[0]!.url).toBe("https://api.anthropic.com/v1/messages");
    expect(r.requests[0]!.apiKeyHeader).toBe("test-anthropic-key");
  });

  test("Mistral, OpenAI (EU residency) and Perplexity over their chat-completions APIs", () => {
    const r = runAi({ ...KEYS, AI_SCORING_PROVIDER: "mistral", AI_WRITING_PROVIDER: "openai" }, [score(), write(), search()]);
    ok(r);
    expect(r.requests.map((req) => req.url)).toEqual([
      "https://api.mistral.ai/v1/chat/completions",
      "https://eu.api.openai.com/v1/chat/completions",
      "https://api.perplexity.ai/chat/completions",
    ]);
    expect(JSON.parse(r.requests[0]!.body).messages[0]).toEqual({ role: "system", content: "Score this CV against the offer." });
    expect(r.outcomes[2]).toMatchObject({ ok: true, value: { answer: "reply from api.perplexity.ai", sources: ["https://jobs.example/offre-1"] } });
  });
});

test.describe("AI layer: personal data only reaches EU-resident endpoints", () => {
  const refusals: [string, Record<string, string>, RegExp][] = [
    ["scoring on the direct Anthropic API", { ANTHROPIC_ENDPOINT: "direct" }, /scoring.*api\.anthropic\.com/],
    ["Bedrock outside the EU", { BEDROCK_REGION: "us-east-1" }, /bedrock us-east-1/],
    ["Vertex outside the EU", { ANTHROPIC_ENDPOINT: "vertex", VERTEX_REGION: "us-east5", VERTEX_PROJECT_ID: "p" }, /vertex us-east5/],
    ["OpenAI without EU data residency", { AI_SCORING_PROVIDER: "openai", OPENAI_DATA_RESIDENCY: "us" }, /api\.openai\.com/],
  ];
  for (const [name, env, message] of refusals) {
    test(`refuses to start: ${name}`, () => {
      const r = runAi({ ...KEYS, ...env }, [score()]);
      expect(r.startup).toMatchObject({ ok: false, error: { name: "DataResidencyError" } });
      if (!r.startup.ok) expect(r.startup.error.message).toMatch(message);
      expect(r.requests).toEqual([]);
    });
  }

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
    expect(body.messages).toHaveLength(1);
    const query: string = body.messages[0].content;
    expect(query).toContain("Développeur TypeScript");
    expect(query).toContain("Paris");
    expect(query).toContain("CDI");
    expect(query).toMatch(/55.000 €/);
    expect(query).not.toMatch(/@|jean|dupont|12 34|\+33/i);
    // Nothing but the model and that single message goes out.
    expect(Object.keys(body).sort()).toEqual(["messages", "model"]);
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

  test("a failed provider call is reported and not counted", () => {
    const r = runAi({ ...KEYS, AI_SCORING_PROVIDER: "mistral" }, [
      { kind: "generate", task: "scoring", candidateId: "cand-1", prompt: "E2E_PROVIDER_DOWN" },
      score("cand-1"),
    ]);
    expect(r.outcomes[0]).toMatchObject({ ok: false, error: { name: "AiProviderError" } });
    expect(r.outcomes[1]).toMatchObject({ ok: true });
    expect(r.usage).toHaveLength(1);
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
