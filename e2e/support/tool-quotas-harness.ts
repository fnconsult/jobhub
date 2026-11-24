/**
 * Drives what a Tool's provider can refuse for its quota (#1114), through the public entry points of each Tool and the
 * module that reads the state, exactly as the server and the worker compose them:
 *
 *   - the AI layer, `createAiLayerFromEnv()` (the AI models, the web search providers), logging to Postgres through
 *     `createPostgresUsageLog` (AI Usage);
 *   - Enriched Contacts' `contactEnrichmentFromEnv()` (Lusha, Kaspr, Apollo) and Fantastic.jobs' `fantasticJobsFromEnv()`,
 *     their calls recorded in `external_api_usage` by `recordingFetch`, as the web app and the worker do;
 *   - `toolQuotaStates()`, the module that reads each Tool's quota state from those recorded calls.
 *
 * The network is the only thing replaced: `globalThis.fetch` answers like each provider, or as the step scripts it.
 * Nothing ever reaches a real provider.
 *
 *   DATABASE_URL=... E2E_QUOTA_SCENARIO='<steps JSON>' tsx e2e/support/tool-quotas-harness.ts
 *
 * Prints one line `QUOTA_HARNESS_RESULT <json>`: for each step, its outcome (the Failure Reason a call failed with) and
 * the quota state of every Tool after it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createAiLayerFromEnv } from "@jobhub/ai";
import { recordingFetch, type ExternalApiLog } from "@jobhub/shared";
import pg from "pg";
import { createPostgresExternalApiLog, createPostgresUsageLog, migrateAiUsage } from "../../apps/web/src/ai-usage";
import { contactEnrichmentFromEnv } from "../../apps/web/src/enriched-contacts/config";
import { toolQuotaStates } from "../../apps/web/src/tool-quotas";
import { fantasticJobsFromEnv } from "../../apps/worker/src/job-discovery/fantastic-jobs";

/** What the next network call answers instead of the provider's accepted answer. */
export interface Reply {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

export type Step =
  | { do: "generate"; label?: string; /** The provider the call is routed to, over its task's default. */ provider?: string; reply?: Reply }
  | { do: "search"; label?: string; reply?: Reply }
  | { do: "contact"; label?: string; provider: "lusha" | "kaspr" | "apollo"; reply?: Reply }
  | { do: "fantastic"; label?: string; reply?: Reply }
  /** A call to an API with no quota of its own: a public API (France Travail), or Stripe, whose 402 is a card declined. */
  | { do: "public"; label?: string; provider: "france_travail" | "stripe"; reply?: Reply }
  /** Reads the states again, `advanceMs` later (a renewal date passing, with no call in between). */
  | { do: "states"; label?: string; advanceMs?: number };

export interface StepResult {
  /** The Failure Reason the call was recorded with, when it failed; "ok" when it was accepted. */
  outcome: string;
  states: Record<string, { state: string; since: string | null; renewsAt: string | null }>;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const fixture = (name: string) => JSON.parse(readFileSync(path.resolve("packages/ai/src/providers/fixtures", `${name}.json`), "utf8"));

/** The reply scripted for the step's network calls (a provider's SDK retries a 429: it answers each time). */
let scripted: Reply | null = null;

/** A provider's accepted answer. */
function accepted(url: URL, body: string): Response {
  const host = url.hostname;
  const parsed = body ? JSON.parse(body) : {};
  if (host === "api.search.brave.com") return json(fixture("brave-web-search"));
  if (host === "api.tavily.com") return json(fixture("tavily-search"));
  if (host === "api.perplexity.ai") return json({ id: "search_e2e", results: [{ title: "Offre", url: "https://jobs.example/offre-1", snippet: "an offer", date: null, last_updated: null }] });
  if (url.pathname.endsWith("/chat/completions")) {
    return json({ id: "cmpl_e2e", model: parsed.model ?? "unknown", choices: [{ index: 0, message: { role: "assistant", content: `reply from ${host}` }, finish_reason: "stop" }], usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 } });
  }
  if (url.pathname.includes("/messages")) {
    return json({ id: "msg_e2e", type: "message", role: "assistant", model: parsed.model ?? "claude", content: [{ type: "text", text: `reply from ${host}` }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 200, output_tokens: 50 } });
  }
  if (host === "api.fantastic.jobs" || url.pathname.includes("active-ats")) return json([], 200, { "x-api-jobs-remaining": "400", "x-api-requests-remaining": "90", "x-api-jobs-this-request": "0" });
  return json({}, 200);
}

const realFetch = globalThis.fetch;
globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
  const request = input instanceof Request ? input : new Request(input, init);
  const url = new URL(request.url);
  const body = await request.text();
  const reply = scripted;
  if (reply) {
    const text = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body ?? {});
    return new Response(text, { status: reply.status, headers: { "content-type": "application/json", ...reply.headers } });
  }
  void realFetch;
  return accepted(url, body);
};

const CV = "Développeur TypeScript, 8 ans d'expérience.";
const criteria = { targetRole: "Développeur TypeScript", locations: ["Paris"], contractTypes: [], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] };

async function main() {
  const steps = JSON.parse(process.env.E2E_QUOTA_SCENARIO ?? "[]") as Step[];
  const database = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const results: StepResult[] = [];
  try {
    await migrateAiUsage(database);
    const usage = createPostgresUsageLog(database);
    const externalApis: ExternalApiLog = createPostgresExternalApiLog(database);
    // Recording a call is not awaited by the call (it never delays it): the harness waits for it before it reads the states.
    const pending = new Set<Promise<unknown>>();
    const tracked: ExternalApiLog = { record: (call) => { const p = Promise.resolve(externalApis.record(call)); pending.add(p); void p.finally(() => pending.delete(p)); return p; } };
    const ai = createAiLayerFromEnv(process.env, { usage, euAiConsent: async () => false });
    const contactEnv = (provider: string) => ({ CONTACT_ENRICHMENT_PROVIDER: provider, CONTACT_ENRICHMENT_DPA_SIGNED: "true", LUSHA_API_KEY: "k-lusha", KASPR_API_KEY: "k-kaspr", APOLLO_API_KEY: "k-apollo" });
    const fantasticEnv = { FANTASTIC_JOBS_API_KEY: "fj-key", FANTASTIC_JOBS_API_URL: "https://api.fantastic.jobs/v1" };
    const fantasticFetch = recordingFetch(globalThis.fetch, tracked, { provider: "fantastic_jobs", costEur: () => 0 });
    const fantastic = fantasticJobsFromEnv(fantasticEnv, { fetch: fantasticFetch, externalApis: tracked })!;
    let clock = Date.now();

    for (const step of steps) {
      let outcome = "ok";
      if (step.do === "states") {
        clock += step.advanceMs ?? 0;
      } else {
        scripted = step.reply ?? null;
        try {
          if (step.do === "generate") await ai.generate({ task: "scoring", candidateId: null, system: "Score this CV.", prompt: CV, ...(step.provider && { route: { provider: step.provider } as never }) });
          else if (step.do === "search") await ai.searchWeb({ candidateId: null, criteria: criteria as never });
          else if (step.do === "contact") {
            const config = contactEnrichmentFromEnv(contactEnv(step.provider), { externalApis: tracked });
            await config.provider!.getContactDetails({ providerPersonId: "person-1" });
          } else if (step.do === "public") {
            await recordingFetch(globalThis.fetch, tracked, { provider: step.provider, costEur: () => 0 })("https://public-api.example/v1/offres");
          } else {
            const result = await fantastic.search(criteria as never, { max: 5, now: new Date(Date.now()), location: "Paris" });
            if (!result.ok) outcome = result.reason;
          }
        } catch (error) {
          outcome = error instanceof Error ? error.name : "error";
        }
        scripted = null;
        // The AI layer's usage log and the external API log are written without the call waiting for them.
        await Promise.all([...pending]);
        await new Promise((resolve) => setTimeout(resolve, 150));
        await Promise.all([...pending]);
        // The latest recorded call tells how it ended: its Failure Reason, or accepted.
        const last = await database.query<{ ok: boolean; reason: string | null; http_status: number | null }>(
          `SELECT ok, reason, http_status FROM (SELECT at, ok, reason, NULL::int AS http_status FROM ai_usage UNION ALL SELECT at, ok, reason, http_status FROM external_api_usage) calls ORDER BY at DESC LIMIT 1`,
        );
        const row = last.rows[0];
        outcome = row ? (row.reason ?? (row.ok ? "ok" : `failed ${row.http_status ?? ""}`.trim())) : outcome;
      }
      const states = await toolQuotaStates(database, new Date(clock));
      const byTool: StepResult["states"] = {};
      for (const state of states) byTool[state.tool.id] = { state: state.state, since: state.since?.toISOString() ?? null, renewsAt: state.renewsAt?.toISOString() ?? null };
      results.push({ outcome, states: byTool });
      // Calls are told apart by their time: never two in one millisecond.
      await new Promise((resolve) => setTimeout(resolve, 5));
      clock = Math.max(clock, Date.now());
    }
  } finally {
    await database.end();
  }
  process.stdout.write(`QUOTA_HARNESS_RESULT ${JSON.stringify(results)}\n`);
}

await main();
