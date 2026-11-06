/**
 * What an AI Coach reply sends, before and after the prompt cache of #790: the AI Coach's Eval Cases (AI_COACH_EVAL_CASES),
 * each played through the AI Coach with its Coach Actions on its fictional objects, on the fake provider counting its tokens
 * from what it is sent (about 4 characters a token) and simulating a prompt cache. Each reply is scripted to use its 2 Tool
 * rounds (EVAL_RUN_ROUNDS): list its objects, read the first, then answer. No Guardrails and no Playbook (their calls have no
 * tools, so nothing of #790 touches them). Prices are Claude Opus 5.5's list prices.
 *
 *   npx tsx apps/web/scripts/measure-coach-cost.ts
 *
 * Latency is not measured: the fake provider answers at once. A provider's cache hit saves its time to first token, which
 * only the Beta's AI Message Log (`durationMs` per Turn) can show.
 */
import { costInEur, createAiLayer, type UsageEntry } from "@jobhub/ai";
import { createFakeProvider, type FakeProviderOptions } from "@jobhub/ai/testing";
import { createCoach } from "../src/coach";
import { forEvalRun } from "../src/coach-actions";
import { shippedCoachActions } from "../src/coach-actions/catalog";
import { fictionalObjects } from "../src/coach-actions/fictional-objects";
import { AI_COACH_EVAL_CASES } from "../src/evals/cases";

const MODEL = "claude-opus-5-5";
const READ_OF = { profile: "read_profile", application: "read_application", job_offer: "read_job_offer", job_search: "read_job_search", job_digest: "read_job_digest" } as const;

interface Played {
  turns: number;
  sent: number;
  cached: number;
  processed: number;
  eur: number;
}

async function play(each: (typeof AI_COACH_EVAL_CASES)[number], fake: FakeProviderOptions): Promise<Played> {
  const first = each.objects?.find((object) => object.type in READ_OF);
  const turns = [
    { toolCalls: [{ name: "list_objects", arguments: {} }] },
    first ? { toolCalls: [{ name: READ_OF[first.type as keyof typeof READ_OF], arguments: { id: first.id } }] } : { toolCalls: [{ name: "list_objects", arguments: { type: "application" } }] },
    { text: "Voici ce que je vous conseille, à partir de vos données." },
  ];
  const provider = createFakeProvider({ id: "anthropic", residency: "eu", measured: true, turns, ...fake });
  const entries: UsageEntry[] = [];
  const ai = createAiLayer({ providers: [provider], routes: { coaching: { provider: "anthropic", model: MODEL } }, usage: { record: (entry) => void entries.push(entry) }, warn: () => {} });
  const objects = fictionalObjects(each.objects ?? []);
  const coach = createCoach({
    ai,
    playbooks: { served: async () => ({ coreDigest: null, sources: null, playbooks: [] }) },
    context: async (_candidate, _focus, maxTokens) => `${each.context}\n\n${each.inView?.text ?? ""}`.slice(0, maxTokens * 4),
    coachActions: forEvalRun(shippedCoachActions(objects), { readsPlayed: true }),
    warn: () => {},
  });
  await coach.reply("eval", { messages: [{ from: "candidate", text: each.message }], ...(each.inView ? { focus: { kind: each.inView.kind, id: "eval" } } : {}) });
  const coaching = entries.filter((entry) => entry.task === "coaching");
  const sum = (count: (entry: UsageEntry) => number) => coaching.reduce((total, entry) => total + count(entry), 0);
  return {
    turns: coaching.length,
    sent: sum((entry) => entry.inputTokens + (entry.cachedInputTokens ?? 0)),
    cached: sum((entry) => entry.cachedInputTokens ?? 0),
    processed: sum((entry) => entry.inputTokens),
    eur: sum((entry) => costInEur({ provider: "anthropic", model: MODEL, usage: entry })),
  };
}

const CONFIGS: [string, FakeProviderOptions][] = [
  ["before #790 (every Turn billed whole)", { promptCache: "explicit", cacheHits: false }],
  ["after, Claude (cache_control)", { promptCache: "explicit" }],
  ["after, no prompt cache (digest of earlier rounds)", {}],
];

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const results: Record<string, Played[]> = {};
for (const [name, fake] of CONFIGS) {
  results[name] = [];
  for (const each of AI_COACH_EVAL_CASES) results[name].push(await play(each, fake));
}
const base = results[CONFIGS[0]![0]]!;
console.log(`${AI_COACH_EVAL_CASES.length} Eval Cases, ${median(base.map((each) => each.turns))} Turns per reply (median)`);
console.log("| | input sent / reply (median) | processed (not cached) | cached share | € / reply (median) | € vs before |");
console.log("|---|---|---|---|---|---|");
for (const [name] of CONFIGS) {
  const played = results[name]!;
  const sent = played.reduce((total, each) => total + each.sent, 0);
  const cached = played.reduce((total, each) => total + each.cached, 0);
  const eur = median(played.map((each) => each.eur));
  const share = (eur / median(base.map((each) => each.eur)) - 1) * 100;
  console.log(
    `| ${name} | ${median(played.map((each) => each.sent))} | ${median(played.map((each) => each.processed))} | ${Math.round((cached / sent) * 100)} % | ${eur.toFixed(4)} | ${share === 0 ? "—" : `${share > 0 ? "+" : ""}${share.toFixed(0)} %`} |`,
  );
}

/**
 * A scripted reply at the limits: a Coach context near the 12k ceiling, two Tool rounds each reading a result of
 * COACH_ACTION_RESULT_MAX_TOKENS (1 500), straight on the AI layer.
 */
async function scripted(fake: FakeProviderOptions) {
  const result = `[${Array.from({ length: 80 }, (_, n) => `{"poste":"Directeur financier ${n}","statut":"envoyée","entreprise":"Globex"}`).join(",")}]`;
  const entries: UsageEntry[] = [];
  const provider = createFakeProvider({ id: "anthropic", measured: true, turns: [{ toolCalls: [{ name: "list_objects", arguments: {} }] }, { toolCalls: [{ name: "read_application", arguments: { id: "a1" } }] }, { text: "Voici." }], ...fake });
  const ai = createAiLayer({ providers: [provider], routes: { coaching: { provider: "anthropic", model: MODEL } }, usage: { record: (entry) => void entries.push(entry) }, warn: () => {} });
  const tools = shippedCoachActions(fictionalObjects([])).map((action) => ({ name: action.name, description: action.description, parameters: { type: "object" } }));
  await ai.generate({
    task: "coaching",
    candidateId: "eval",
    containsIdentity: false,
    system: "Règle : réponds à partir des données du candidat. ".repeat(700),
    prompt: [{ role: "user", content: "Où en sont mes candidatures ?" }],
    tools,
    runTool: async () => ({ content: result }),
    maxToolRounds: 2,
  });
  const sum = (count: (entry: UsageEntry) => number) => entries.reduce((total, entry) => total + count(entry), 0);
  return { sent: sum((entry) => entry.inputTokens + (entry.cachedInputTokens ?? 0)), processed: sum((entry) => entry.inputTokens), cached: sum((entry) => entry.cachedInputTokens ?? 0), eur: sum((entry) => costInEur({ provider: "anthropic", model: MODEL, usage: entry })) };
}

console.log("\nScripted reply at the limits (context ~9k, 2 reads of ~1.5k, 3 Turns):");
console.log("| | input sent | processed (not cached) | cached share | € | € vs before |");
console.log("|---|---|---|---|---|---|");
let before = 0;
for (const [name, fake] of CONFIGS) {
  const played = await scripted(fake);
  before ||= played.eur;
  console.log(`| ${name} | ${played.sent} | ${played.processed} | ${Math.round((played.cached / played.sent) * 100)} % | ${played.eur.toFixed(4)} | ${played.eur === before ? "—" : `${((played.eur / before - 1) * 100).toFixed(0)} %`} |`);
}
