import { spawnSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
import pg from "pg";
import type { Reply, Step, StepResult } from "./support/tool-quotas-harness";

// Issue #1114: a Tool with an API reaching its quota at its provider is recognised, and its state read.
//
// The Tool quota states have no page yet (the module `apps/web/src/tool-quotas` is read-only, not wired to a page), so the
// public entry points here are the ones the app composes: the AI layer (`createAiLayerFromEnv`, AI Usage), Enriched
// Contacts' provider (`contactEnrichmentFromEnv`), Fantastic.jobs' client (`fantasticJobsFromEnv`), the recorded calls they
// leave in Postgres, and `toolQuotaStates()` reading them (e2e/support/tool-quotas-harness.ts). Each scenario runs in a
// fresh process, on a throwaway database of its own. The network is the only thing replaced: each provider answers with the
// reply its documented API gives; no real provider is ever contacted. Consommation IA and Outils count the new
// Failure Reason like any other: e2e/tool-quota-consumption.spec.ts.

const tsx = path.resolve("node_modules/.bin/tsx");
const harness = path.resolve("e2e/support/tool-quotas-harness.ts");
const baseUrl = process.env.DATABASE_URL ?? "postgres://jobhub:jobhub@localhost:5432/jobhub";

/** The Tools with a quota at their provider, as the module lists them (Claude on Vertex is not driven here: its answers are Anthropic's). */
const TOOLS_WITH_A_QUOTA = ["anthropic", "anthropic-bedrock", "anthropic-vertex", "mistral", "openai", "perplexity", "brave", "tavily", "fantastic-jobs", "lusha", "kaspr", "apollo"];

/** Keys for every provider the scenarios call, and where their calls are routed. */
const KEYS = {
  ANTHROPIC_API_KEY: "test-anthropic-key",
  MISTRAL_API_KEY: "test-mistral-key",
  OPENAI_API_KEY: "test-openai-key",
  PERPLEXITY_API_KEY: "test-perplexity-key",
  BRAVE_SEARCH_API_KEY: "test-brave-key",
  TAVILY_API_KEY: "test-tavily-key",
};
const DIRECT = { ...KEYS, ANTHROPIC_ENDPOINT: "direct", AI_SCORING_PROVIDER: "mistral" };

const databaseUrlOf = (name: string) => {
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  return url.toString();
};
async function adminQuery(sql: string) {
  const admin = new pg.Client({ connectionString: baseUrl });
  await admin.connect();
  try {
    await admin.query(sql);
  } finally {
    await admin.end();
  }
}

/** The migrated schema (`npm run db:migrate`), made once and copied for each scenario: its throwaway database. */
const template = `jobhub_e2e_quota_template_${process.pid}`;
test.beforeAll(async () => {
  await adminQuery(`CREATE DATABASE ${template}`);
  const migrated = spawnSync("npm", ["run", "db:migrate"], { env: { ...process.env, DATABASE_URL: databaseUrlOf(template) }, encoding: "utf8", timeout: 240_000 });
  if (migrated.status !== 0) throw new Error(`db:migrate failed:\n${migrated.stdout}\n${migrated.stderr}`);
});
test.afterAll(async () => {
  await adminQuery(`DROP DATABASE IF EXISTS ${template} WITH (FORCE)`);
});

async function withDatabase<T>(run: (url: string) => Promise<T>): Promise<T> {
  const name = `jobhub_e2e_quota_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
  const admin = new pg.Client({ connectionString: baseUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name} TEMPLATE ${template}`);
  try {
    const url = new URL(baseUrl);
    url.pathname = `/${name}`;
    return await run(url.toString());
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  }
}

/** Runs `steps` in a fresh process on a fresh database: what each step ended with, and every Tool's state after it. */
async function run(env: Record<string, string>, steps: Step[]): Promise<StepResult[]> {
  return withDatabase(async (databaseUrl) => {
    const result = spawnSync(tsx, [harness], {
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env, DATABASE_URL: databaseUrl, E2E_QUOTA_SCENARIO: JSON.stringify(steps) },
      encoding: "utf8",
      timeout: 90_000,
    });
    const line = result.stdout.split("\n").find((each) => each.startsWith("QUOTA_HARNESS_RESULT "));
    if (!line) throw new Error(`Quota harness failed (exit ${result.status}):\n${result.stdout}\n${result.stderr}`);
    return JSON.parse(line.slice("QUOTA_HARNESS_RESULT ".length)) as StepResult[];
  });
}

const generate = (reply?: Reply, provider?: string): Step => ({ do: "generate", ...(provider && { provider }), ...(reply && { reply }) });
const refusal = (status: number, body: unknown, headers?: Record<string, string>): Reply => ({ status, body, ...(headers && { headers }) });

/** A provider's documented refusal, the Tool it is for, and the Failure Reason it gives. */
interface Case {
  label: string;
  tool: string;
  step: Step;
  reason: "quota_exhausted" | "rate_limited";
}
const aiCase = (label: string, tool: string, provider: string, reply: Reply, reason: Case["reason"]): Case => ({ label, tool, reason, step: { do: "generate", provider, reply } });
const searchCase = (label: string, tool: string, reply: Reply, reason: Case["reason"]): Case => ({ label, tool, reason, step: { do: "search", reply } });
const contactCase = (label: string, provider: "lusha" | "kaspr" | "apollo", reply: Reply, reason: Case["reason"]): Case => ({ label, tool: provider, reason, step: { do: "contact", provider, reply } });

const ANTHROPIC_CREDITS = refusal(400, { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits." } });
const OPENAI_NO_CREDIT = refusal(429, { error: { message: "You exceeded your current quota, please check your plan and billing details.", type: "insufficient_quota", code: "insufficient_quota" } });
const OPENAI_RATE = refusal(429, { error: { message: "Rate limit reached for gpt-5.5 in organization org-x on requests per min (RPM): Limit 3, Used 3. Please try again in 20s.", type: "requests", code: "rate_limit_exceeded" } });

/** Every group runs its cases in one process, on the environment it needs; each case's Tool takes the state its reason gives. */
const GROUPS: { name: string; env: Record<string, string>; cases: Case[] }[] = [
  {
    name: "Anthropic API, OpenAI, Mistral, Lusha, Kaspr and Apollo",
    env: DIRECT,
    cases: [
      aiCase("Anthropic API: a 400 « credit balance is too low »", "anthropic", "anthropic", ANTHROPIC_CREDITS, "quota_exhausted"),
      aiCase("OpenAI: a 429 insufficient_quota", "openai", "openai", OPENAI_NO_CREDIT, "quota_exhausted"),
      aiCase("OpenAI: a 429 of rate", "openai", "openai", OPENAI_RATE, "rate_limited"),
      aiCase("Mistral: a 402", "mistral", "mistral", refusal(402, { message: "Payment required" }), "quota_exhausted"),
      aiCase("Mistral: a 429", "mistral", "mistral", refusal(429, { message: "Rate limit exceeded" }), "rate_limited"),
      aiCase("Mistral: a plan spent said in words", "mistral", "mistral", refusal(400, { message: "Quota exceeded for your plan" }), "quota_exhausted"),
      contactCase("Lusha: a 402 out_of_credits", "lusha", refusal(402, { error: "out_of_credits" }), "quota_exhausted"),
      contactCase("Lusha: a 429", "lusha", refusal(429, { error: "rate limit" }), "rate_limited"),
      contactCase("Kaspr: a 402 out_of_credits", "kaspr", refusal(402, { error: "out_of_credits" }), "quota_exhausted"),
      contactCase("Kaspr: a 429", "kaspr", refusal(429, { error: "rate limit" }), "rate_limited"),
      contactCase("Apollo: a 402 out_of_credits", "apollo", refusal(402, { error: "out_of_credits" }), "quota_exhausted"),
      contactCase("Apollo: a 429", "apollo", refusal(429, { error: "rate limit" }), "rate_limited"),
    ],
  },
  {
    name: "Anthropic on Bedrock",
    env: { ...KEYS, ANTHROPIC_API_KEY: "", ANTHROPIC_ENDPOINT: "bedrock", AWS_BEARER_TOKEN_BEDROCK: "test-bedrock-key", AI_SCORING_PROVIDER: "anthropic" },
    cases: [
      aiCase("Bedrock: a 400 « credit balance is too low »", "anthropic-bedrock", "anthropic", ANTHROPIC_CREDITS, "quota_exhausted"),
      aiCase("Bedrock: a 429", "anthropic-bedrock", "anthropic", refusal(429, { message: "Too many requests" }), "rate_limited"),
    ],
  },
  {
    name: "Perplexity",
    env: { ...DIRECT, AI_WEB_SEARCH_PROVIDER: "perplexity" },
    cases: [
      searchCase("Perplexity: a 402", "perplexity", refusal(402, { error: { message: "Insufficient credits" } }), "quota_exhausted"),
      searchCase("Perplexity: a 429", "perplexity", refusal(429, { error: { message: "Too many requests" } }), "rate_limited"),
    ],
  },
  {
    name: "Brave",
    env: { ...DIRECT, AI_WEB_SEARCH_PROVIDER: "brave" },
    cases: [
      searchCase("Brave: a 402", "brave", refusal(402, { error: { code: "PAYMENT_REQUIRED" } }), "quota_exhausted"),
      searchCase("Brave: a 429 QUOTA_LIMITED (its plan's month spent)", "brave", refusal(429, { type: "ErrorResponse", error: { code: "QUOTA_LIMITED", status: 429, detail: "Request rate limit exceeded for plan" } }), "quota_exhausted"),
      searchCase("Brave: a 429 of rate", "brave", refusal(429, { type: "ErrorResponse", error: { code: "RATE_LIMITED", status: 429 } }), "rate_limited"),
    ],
  },
  {
    name: "Tavily",
    env: { ...DIRECT, AI_WEB_SEARCH_PROVIDER: "tavily" },
    cases: [
      searchCase("Tavily: a 432 (its plan's limit)", "tavily", refusal(432, { detail: { error: "This request exceeds your plan's set usage limit." } }), "quota_exhausted"),
      searchCase("Tavily: a 433 (its pay-as-you-go limit)", "tavily", refusal(433, { detail: { error: "This request exceeds the pay-as-you-go limit." } }), "quota_exhausted"),
      searchCase("Tavily: a 429", "tavily", refusal(429, { detail: { error: "Too many requests" } }), "rate_limited"),
    ],
  },
];

test.describe("Tool quota states: each provider's refusal gives its Failure Reason, and its Tool's state (#1114)", () => {
  for (const group of GROUPS) {
    test(`${group.name}: each documented answer is recorded with the right Failure Reason and gives its Tool's state`, async () => {
      const results = await run(group.env, group.cases.map((each) => each.step));
      group.cases.forEach((each, index) => {
        const after = results[index]!;
        expect(after.outcome, each.label).toBe(each.reason);
        expect(after.states[each.tool]?.state, `${each.label}: ${each.tool}'s state`).toBe(each.reason);
        expect(after.states[each.tool]?.since, `${each.label}: since`).not.toBeNull();
      });
    });
  }

  test("a rate limit and a credit spent stay apart, OpenAI included: the same 429, two Failure Reasons, two states", async () => {
    const [spent, rate, spentAgain] = await run(DIRECT, [generate(OPENAI_NO_CREDIT, "openai"), generate(OPENAI_RATE, "openai"), generate(OPENAI_NO_CREDIT, "openai")]);
    expect([spent!.outcome, rate!.outcome, spentAgain!.outcome]).toEqual(["quota_exhausted", "rate_limited", "quota_exhausted"]);
    expect([spent!.states.openai!.state, rate!.states.openai!.state, spentAgain!.states.openai!.state]).toEqual(["quota_exhausted", "rate_limited", "quota_exhausted"]);
    // Its state started anew with each change of reason: the credit spent again is not « since » the first one.
    expect(spentAgain!.states.openai!.since).not.toBe(spent!.states.openai!.since);
  });

  test("Fantastic.jobs: a 402 gives quota_exhausted, a 429 rate_limited, and a search its quota guard holds back is recorded with its reason", async () => {
    const [spent, held] = await run(DIRECT, [{ do: "fantastic", reply: refusal(402, { message: "Payment required" }) }, { do: "fantastic" }]);
    expect(spent!.outcome).toBe("quota_exhausted");
    expect(spent!.states["fantastic-jobs"]!.state).toBe("quota_exhausted");
    // The second search made no call (ADR-0031): the guard held it back, and recorded it, with its reason.
    expect(held!.outcome).toBe("quota_exhausted");
    expect(held!.states["fantastic-jobs"]!.state).toBe("quota_exhausted");
    expect(held!.states["fantastic-jobs"]!.since).toBe(spent!.states["fantastic-jobs"]!.since);

    const [limited, heldForRate] = await run(DIRECT, [{ do: "fantastic", reply: refusal(429, {}, { "retry-after": "60" }) }, { do: "fantastic" }]);
    expect(limited!.outcome).toBe("rate_limited");
    expect(limited!.states["fantastic-jobs"]!.state).toBe("rate_limited");
    expect(heldForRate!.outcome).toBe("rate_limited");
  });

  test("the module gives quota_exhausted after a single refusal, then ok after an accepted call of that same Tool, not another's", async () => {
    const results = await run(DIRECT, [
      generate(undefined, "openai"), // accepted: nothing to read yet
      generate(OPENAI_NO_CREDIT, "openai"), // one refusal
      generate(undefined, "mistral"), // another Tool accepted: ends nothing
      generate(undefined, "openai"), // its own Tool accepted
    ]);
    const openai = results.map((step) => step.states.openai!.state);
    expect(openai).toEqual(["ok", "quota_exhausted", "quota_exhausted", "ok"]);
    expect(results[1]!.states.openai!.since).not.toBeNull();
    expect(results[3]!.states.openai).toEqual({ state: "ok", since: null, renewsAt: null });
    expect(results[2]!.states.mistral!.state).toBe("ok");
  });

  test("the module gives the renewal date the provider gave: its retry-after, Fantastic.jobs' next billing date; and ok once it has passed", async () => {
    const billing = "2099-01-01T00:00:00.000Z";
    const results = await run(DIRECT, [
      generate(refusal(429, { error: { message: "Rate limit reached", code: "rate_limit_exceeded" } }, { "retry-after": "120" }), "mistral"),
      generate(refusal(429, { error: { message: "Rate limit reached", code: "rate_limit_exceeded" } }), "openai"),
      { do: "fantastic", reply: refusal(402, {}, { "x-api-next-billing-date": billing }) },
      { do: "states", advanceMs: 10 * 60_000 },
    ]);
    const mistral = results[0]!.states.mistral!;
    const waited = Date.parse(mistral.renewsAt!) - Date.parse(mistral.since!);
    expect(mistral.state).toBe("rate_limited");
    expect(waited).toBeGreaterThan(110_000);
    expect(waited).toBeLessThan(130_000);
    // A provider that gave no date gives none: the module invents nothing.
    expect(results[1]!.states.openai).toMatchObject({ state: "rate_limited", renewsAt: null });
    expect(results[2]!.states["fantastic-jobs"]).toMatchObject({ state: "quota_exhausted", renewsAt: billing });
    // Ten minutes later, with no call in between: Mistral's retry-after has passed, the others' have not.
    const later = results[3]!.states;
    expect(later.mistral!.state).toBe("ok");
    expect(later.openai!.state).toBe("rate_limited");
    expect(later["fantastic-jobs"]!.state).toBe("quota_exhausted");
  });

  test("the states list the Tools with a quota only: a public API or a Tool of our own refused is no state, nor is a failure that is no quota's", async () => {
    const results = await run(DIRECT, [
      { do: "public", provider: "france_travail", reply: refusal(429, {}) },
      { do: "public", provider: "stripe", reply: refusal(402, { error: { code: "card_declined" } }) },
      generate(refusal(503, { message: "upstream unavailable" }), "openai"),
      { do: "contact", provider: "apollo", reply: refusal(500, {}) },
    ]);
    const last = results.at(-1)!;
    expect(Object.keys(last.states).sort()).toEqual([...TOOLS_WITH_A_QUOTA].sort());
    expect(Object.keys(last.states)).not.toContain("france-travail");
    expect(Object.keys(last.states)).not.toContain("stripe");
    for (const step of results) for (const state of Object.values(step.states)) expect(state).toEqual({ state: "ok", since: null, renewsAt: null });
    // The failures kept their own Failure Reasons.
    expect(results[2]!.outcome).toBe("provider_unavailable");
  });
});
