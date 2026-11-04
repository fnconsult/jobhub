/**
 * Drives the AI Coach with its Coach Actions (#713, ADR-0077) through the entry point the web server uses: `createCoach`
 * from apps/web/src/coach, on the AI layer `createAiLayerFromEnv()` builds from the process environment, the Coach
 * Actions from `createCoachActions`. The catalogue shipped is empty until each group's ticket, so this harness
 * declares a fake Coach Action of each kind (a read, a proposal that copies no text, a proposal that copies text)
 * on a fake domain module scoped to its Candidate.
 *
 * The provider is the suite's own fake Mistral (fake-mistral.mjs, imported first: it answers api.eu.mistral.ai in
 * process); a Candidate message holding `E2E_COACH_TOOL=<name>:<json>` has the AI Coach call that Coach Action.
 * Nothing reaches a real provider. The harness records what leaves the process (the tools each `coaching` request
 * offers), the AI Message Log's entries (AI Usage with their transcripts), `external_api_usage`, the reply's Provenance
 * and the proposals.
 *
 *   tsx e2e/support/coach-actions-harness.ts '<scenario JSON>'
 *
 * Prints one line `COACH_ACTIONS_RESULT <json>`.
 */
import "./fake-mistral.mjs";
import { createAiLayerFromEnv } from "@jobhub/ai";
import { createMemoryUsageLog } from "@jobhub/ai/testing";
import type { ExternalApiCall } from "@jobhub/shared";
import * as z from "zod";
import { createCoach, type CoachFocus } from "../../apps/web/src/coach";
import { coachActionCatalog, createCoachActions, defineCoachAction, forEvalRun, type CoachAction } from "../../apps/web/src/coach-actions";
import { AI_COACH_EVAL_CASES } from "../../apps/web/src/evals/cases";
import { createGuardrails, DEFAULT_GUARDRAIL_MESSAGES, GUARDRAIL_IDS, type GuardrailId, type GuardrailSetting } from "../../apps/web/src/guardrails";

export interface Scenario {
  /** COACH_ACTIONS_ENABLED and COACH_TOOL_ROUNDS_MAX as Paramètres sets them. */
  settings: { enabled: boolean; maxRounds: number };
  /** No `coachActions` dependency at all: the AI Coach as it was before Coach Actions. */
  withoutCoachActions?: boolean;
  /** The Guardrails (input check on what a Coach Action read included) in front of the AI Coach. */
  guarded?: boolean;
  /** The text of Marie's Application a1 (a Job Offer's posting, written by someone else). */
  posting?: string;
  replies: { candidateId: string; text: string; focus?: CoachFocus }[];
  /** Play the AI Coach's own Eval Cases with these ids as an Eval Run does (forEvalRun), each reply scripted by `scripted`. */
  evalCases?: { id: string; scripted?: string }[];
}

export interface HarnessReply {
  ok: boolean;
  reply?: string;
  proposals?: unknown[];
  steps?: unknown[];
  sites?: unknown[];
  error?: string;
}

export interface HarnessResult {
  replies: HarnessReply[];
  /** The tools each `coaching` request offered (null: no `tools` in the request), in order. */
  offered: (string[] | null)[];
  /** The `coaching` requests' system prompt, in order. */
  systems: string[];
  /** The `coaching` requests' tool results (the messages with role `tool`), in order. */
  toolResults: string[][];
  externalApi: ExternalApiCall[];
  /** The AI Message Log: each AI call's task and its transcript. */
  messageLog: { task: string; transcript: string }[];
  /** Marie's Application a1 and Paul's p1 after the replies: a Coach Action writes nothing. */
  applications: Record<string, string>;
  /** What a catalogue holding a Coach Action of a group no « Routes locales » Tool declares does when the AI Coach is offered it. */
  undeclared: { catalogue: string | null; offered: string | null };
  evals: { id: string; offered: string[] | null; proposals: number; reply: string | null; system: string }[];
}

const scenario = JSON.parse(process.argv[2] ?? "{}") as Scenario;

/** Marie's and Paul's Applications, as a domain module scoped to its Candidate gives them: anyone else's id is not found. */
const APPLICATIONS: Record<string, { id: string; title: string; status: string; posting: string }[]> = {
  marie: [{ id: "a1", title: "DAF H/F", status: "interview", posting: scenario.posting ?? "Rattaché au DG, vous pilotez la clôture mensuelle." }],
  paul: [{ id: "p1", title: "DSI", status: "applied", posting: "" }],
};
const applicationOf = async (candidateId: string, id: string) => APPLICATIONS[candidateId]?.find((each) => each.id === id) ?? null;

/** A fake Coach Action of each kind, and one that copies text. */
const CATALOG: readonly CoachAction[] = [
  defineCoachAction({
    name: "lire_candidature",
    description: "Lit une candidature du candidat par son id.",
    schema: z.object({ id: z.string() }),
    group: "applications",
    kind: "read",
    copiesText: false,
    async run({ id }, { candidateId }) {
      const found = await applicationOf(candidateId, id);
      return found ? { ok: true, data: found, pages: [`/candidatures/${id}`], untrusted: true } : { ok: false, error: "not_found" };
    },
  }),
  defineCoachAction({
    name: "proposer_statut",
    description: "Propose un nouveau statut pour une candidature du candidat.",
    schema: z.object({ id: z.string(), status: z.enum(["applied", "interview", "offer", "rejected", "withdrawn"]) }),
    group: "applications",
    kind: "propose",
    copiesText: false,
    async run({ id, status }, { candidateId }) {
      const found = await applicationOf(candidateId, id);
      return found ? { ok: true, data: { applicationId: id, from: found.status, to: status } } : { ok: false, error: "not_found" };
    },
  }),
  defineCoachAction({
    name: "proposer_resume_cv",
    description: "Propose un nouveau résumé du CV de référence.",
    schema: z.object({ summary: z.string() }),
    group: "profile",
    kind: "propose",
    copiesText: true,
    async run({ summary }) {
      return { ok: true, data: { summary } };
    },
  }),
];

// What leaves the process: the tools each `coaching` request offers, and the tool results it carries.
const realFetch = globalThis.fetch;
const offered: HarnessResult["offered"] = [];
const systems: string[] = [];
const toolResults: string[][] = [];
globalThis.fetch = async (input, init) => {
  const request = input instanceof Request ? input.clone() : undefined;
  const body = JSON.parse(request ? await request.text() : String(init?.body ?? "{}")) as {
    messages?: { role: string; content: unknown }[];
    tools?: { function?: { name: string } }[];
  };
  const system = String(body.messages?.find((message) => message.role === "system")?.content ?? "");
  // The AI Coach's own call: not the Guardrails' checks, nor the choice of Playbook Agents.
  if (system.includes("Jobbbox") && !system.startsWith("Tu contrôles") && !system.startsWith("Tu choisis") && !system.startsWith("Tu es le juge")) {
    offered.push(body.tools ? body.tools.map((tool) => tool.function?.name ?? "") : null);
    systems.push(system);
    toolResults.push((body.messages ?? []).filter((message) => message.role === "tool").map((message) => String(message.content)));
  }
  return realFetch(input, init);
};

const usage = createMemoryUsageLog();
const env = {
  PATH: process.env.PATH ?? "",
  AI_COACHING_PROVIDER: "mistral",
  AI_GUARDRAIL_PROVIDER: "mistral",
  AI_EVAL_PROVIDER: "mistral",
  AI_SCORING_PROVIDER: "mistral",
  AI_WRITING_PROVIDER: "mistral",
  AI_CV_PARSING_PROVIDER: "mistral",
  AI_OFFER_ANALYSIS_PROVIDER: "mistral",
  AI_OFFER_EMAIL_READING_PROVIDER: "mistral",
  MISTRAL_API_KEY: "e2e-mistral-key",
};
const ai = createAiLayerFromEnv(env, { usage });
const externalApi: ExternalApiCall[] = [];
const coachActions = createCoachActions({ catalog: CATALOG, settings: async () => scenario.settings, externalApis: { record: (call) => void externalApi.push(call) } });
const guardrails = createGuardrails({
  ai,
  config: { current: async () => ({ settings: Object.fromEntries(GUARDRAIL_IDS.map((id) => [id, "block"])) as Record<GuardrailId, GuardrailSetting>, messages: DEFAULT_GUARDRAIL_MESSAGES }) },
  triggers: { record: () => {} },
});
const coach = createCoach({
  ai,
  playbooks: { served: async () => ({ coreDigest: null, sources: null, playbooks: [] }) },
  context: async () => "Le candidat s'appelle Marie (prénom seulement).",
  ...(scenario.withoutCoachActions ? {} : { coachActions }),
  ...(scenario.guarded ? { guardrails } : {}),
  warn: () => {},
});

const result: HarnessResult = { replies: [], offered, systems, toolResults, externalApi, messageLog: [], applications: {}, undeclared: { catalogue: null, offered: null }, evals: [] };

for (const each of scenario.replies ?? []) {
  const replied = await coach.reply(each.candidateId, { messages: [{ from: "candidate", text: each.text }], ...(each.focus ? { focus: each.focus } : {}) });
  result.replies.push(
    replied.ok
      ? { ok: true, reply: replied.reply, proposals: replied.proposals, steps: replied.provenance.steps, sites: replied.provenance.sites }
      : { ok: false, error: replied.error },
  );
}

// The AI Coach's own Eval Cases, played as an Eval Run plays them: the catalogue offered on no one's data (forEvalRun).
for (const each of scenario.evalCases ?? []) {
  const evalCase = AI_COACH_EVAL_CASES.find((one) => one.id === each.id);
  if (!evalCase) throw new Error(`no Eval Case "${each.id}"`);
  const before = offered.length;
  const evalCoach = createCoach({
    ai,
    playbooks: { served: async () => ({ coreDigest: null, sources: null, playbooks: [] }) },
    context: async () => `${evalCase.context}\n\n${evalCase.inView ? evalCase.inView.text : ""}`,
    coachActions: forEvalRun(CATALOG),
    warn: () => {},
  });
  const text = each.scripted ? `${evalCase.message} E2E_COACH_TOOL=${each.scripted}` : evalCase.message;
  const replied = await evalCoach.reply("eval", { messages: [{ from: "candidate", text }], ...(evalCase.inView ? { focus: { kind: evalCase.inView.kind, id: "eval" } } : {}) });
  result.evals.push({
    id: each.id,
    offered: offered[before] ?? null,
    proposals: replied.ok ? (replied.proposals?.length ?? 0) : -1,
    reply: replied.ok ? replied.reply : null,
    system: systems[before] ?? "",
  });
}

// A Coach Action whose group no Routes locales Tool declares could not have its calls recorded: refused.
const undeclared = defineCoachAction({
  name: "lire_facture",
  description: "Lit une facture.",
  schema: z.object({}),
  group: "billing" as never,
  kind: "read",
  copiesText: false,
  run: async () => ({ ok: true, data: null }),
});
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
try {
  coachActionCatalog([undeclared]);
} catch (error) {
  result.undeclared.catalogue = messageOf(error);
}
try {
  await createCoachActions({ catalog: [undeclared], settings: async () => ({ enabled: true, maxRounds: 2 }), externalApis: { record: () => {} } }).forReply("marie", {
    recorder: { step: async (_subject, run) => run(), site: () => {} },
    untrustedInView: false,
  });
} catch (error) {
  result.undeclared.offered = messageOf(error);
}

result.messageLog = usage.entries.map((entry) => ({ task: entry.task, transcript: JSON.stringify(entry.transcript) }));
result.applications = Object.fromEntries(Object.values(APPLICATIONS).flat().map((application) => [application.id, application.status]));
process.stdout.write(`COACH_ACTIONS_RESULT ${JSON.stringify(result)}\n`);
