import { createAiLayer, type AgentModelChoice, type TextInput } from "@jobhub/ai";
import { createFakeProvider, createMemoryUsageLog, type FakeProvider, type MemoryUsageLog } from "@jobhub/ai/testing";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCoachingPlaybooks, migrateCoachingPlaybooks, type CoachingPlaybooks, type PlaybookSeed } from "../coaching-playbooks";
import { DEFAULT_GUARDRAIL_MESSAGES, GUARDRAIL_IDS, type GuardrailId, type GuardrailSetting } from "../guardrails";
import { createThrowawayDatabase, type ThrowawayDatabase } from "../test-support/throwaway-database";
import { createEvals, migrateEvals, type Evals } from "./index";

const connectionString = process.env.DATABASE_URL;

const SOURCES = ["# Sources", "", "| ID | Titre | Auteur | Année | URL | Licence |", "|--|--|--|--|--|--|", "| S1 | Étude 1 | Apec | 2026 | https://apec.fr/1 | publique |"].join("\n");

const agent = { provider: "mistral" as const, model: "mistral-medium-3-5", effort: "medium" as const, consultWhen: "Quand le candidat prépare un entretien." };

const SEED: PlaybookSeed = {
  sources: SOURCES,
  coreDigest: "# Socle\n\n- Jamais de promesse de résultat [S1].",
  playbooks: [
    { id: "interview-psychology", content: "# Psychologie de l'entretien\n\n**R1. Respirez.** [S1]", agent },
    { id: "ats-optimization", content: "# Optimiser son CV pour les ATS\n\n**R1. Des mots-clés.** [S1]", agent: { ...agent, consultWhen: "Quand il est question d'ATS." } },
  ],
};

/** The EU-resident models a Playbook Agent may use in these tests; the judge is outside the EU. */
const MODELS: AgentModelChoice[] = [
  { provider: "mistral", endpoint: "fake mistral", models: [{ model: "mistral-medium-3-5", effort: "medium_as_high" }, { model: "mistral-large-latest", effort: "ignored" }] },
];

const claire = { email: "claire@jobbbox.fr" };
const paul = { email: "paul@jobbbox.fr", name: "Paul Martin" };

const CASE = {
  title: "Prépare un entretien avec un DG",
  context: "Le candidat s'appelle Paul (prénom seulement). Il a 54 ans et vise un poste de DAF.",
  message: "J'ai un entretien jeudi avec le DG. Comment me préparer ?",
  inViewKind: "job_offer",
  inViewText: "DAF H/F chez Acme Industrie, Lyon. Rattaché au DG.",
  criteria: "La réponse propose trois exemples chiffrés à préparer et des questions à poser au DG.",
};

/** The AI's side, told apart by what each call is asked: the judge, the Guardrails' checks, the choice, a Playbook Agent, the AI Coach. */
interface Answers {
  judge?: (input: TextInput) => string;
  advise?: (input: TextInput) => string;
  reply?: (input: TextInput) => string;
  inputVerdict?: (input: TextInput) => string;
  outputVerdict?: (input: TextInput) => string;
}

function answering(answers: Answers) {
  return (input: TextInput): string => {
    const system = input.system ?? "";
    if (system.startsWith("Tu es le juge")) return answers.judge?.(input) ?? '{"score": 8, "raison": "Concret et adapté."}';
    if (system.startsWith("Tu contrôles le message")) return answers.inputVerdict?.(input) ?? "{}";
    if (system.startsWith("Tu contrôles la réponse")) return answers.outputVerdict?.(input) ?? "{}";
    if (system.startsWith("Tu choisis quels Playbook Agents")) return "[]";
    if (/<playbook id="/.test(system)) return answers.advise?.(input) ?? "Préparez trois exemples chiffrés [S1].";
    return answers.reply?.(input) ?? "Préparez trois exemples chiffrés, et demandez au DG ses priorités.";
  };
}

describe.skipIf(!connectionString)("Eval Cases and Eval Runs (ADR-0023, #231; needs Postgres: DATABASE_URL)", () => {
  let throwaway: ThrowawayDatabase;
  let database: Pool;
  let playbooks: CoachingPlaybooks;
  let mistral: FakeProvider;
  let judge: FakeProvider;
  let usage: MemoryUsageLog;
  let answers: Answers;
  let settings: Record<GuardrailId, GuardrailSetting>;
  let evals: Evals;

  beforeEach(async () => {
    throwaway = await createThrowawayDatabase("test_evals");
    database = throwaway.pool;
    await migrateCoachingPlaybooks(database, () => SEED);
    await migrateEvals(database);
    answers = {};
    settings = Object.fromEntries(GUARDRAIL_IDS.map((id) => [id, "block"])) as Record<GuardrailId, GuardrailSetting>;
    mistral = createFakeProvider({ id: "mistral", reply: (input) => answering(answers)(input), models: ["mistral-medium-3-5", "mistral-large-latest"] });
    judge = createFakeProvider({ id: "openai", residency: "outside_eu", reply: (input) => answering(answers)(input) });
    usage = createMemoryUsageLog();
    const ai = createAiLayer({ providers: [mistral, judge], routes: { coaching: "mistral", guardrail: "mistral", eval: "openai" }, usage });
    playbooks = createCoachingPlaybooks(database, { serving: "latest", agentModels: () => MODELS, evalRunOn: (version, within) => evals.playedOn(version, within).then(Boolean) });
    evals = createEvals(database, {
      ai,
      playbooks,
      guardrails: { current: async () => ({ settings, messages: DEFAULT_GUARDRAIL_MESSAGES }) },
    });
  }, 60_000);
  afterEach(async () => {
    await throwaway.drop();
  }, 60_000);

  describe("a Coaching Playbook's Eval Cases", () => {
    it("are written in the Back Office by a Playbook editor, and belong to the playbook", async () => {
      const added = await evals.addCase(claire, "interview-psychology", CASE);

      expect(added).toMatchObject({ ok: true, evalCase: { id: expect.any(String), playbookId: "interview-psychology", title: CASE.title, inView: { kind: "job_offer", text: CASE.inViewText }, author: "claire@jobbbox.fr" } });
      expect((await evals.cases("interview-psychology")).map((each) => each.title)).toEqual([CASE.title]);
      expect(await evals.cases("ats-optimization")).toEqual([]);
    });

    it("belong to the playbook, not to a Playbook Version: saving the playbook keeps them, with no validation of their own", async () => {
      await evals.addCase(claire, "interview-psychology", CASE);
      await playbooks.save(claire, "interview-psychology", { content: "# Psychologie de l'entretien\n\n**R1. Souriez.** [S1]", ...agent });

      expect(await evals.cases("interview-psychology")).toEqual([expect.objectContaining({ title: CASE.title })]);
    });

    it("can be changed and removed, each change saying what it was before", async () => {
      const added = await evals.addCase(claire, "interview-psychology", CASE);
      if (!added.ok) throw new Error("not added");

      const saved = await evals.saveCase({ email: "nina@jobbbox.fr" }, "interview-psychology", added.evalCase.id, { ...CASE, inViewKind: "", inViewText: "", criteria: "Trois exemples chiffrés." });
      const removed = await evals.removeCase("interview-psychology", added.evalCase.id);

      expect(saved).toMatchObject({ ok: true, before: { criteria: CASE.criteria }, evalCase: { criteria: "Trois exemples chiffrés.", inView: null, author: "nina@jobbbox.fr" } });
      expect(removed).toMatchObject({ ok: true, before: { criteria: "Trois exemples chiffrés." } });
      expect(await evals.cases("interview-psychology")).toEqual([]);
      expect(await evals.removeCase("interview-psychology", added.evalCase.id)).toEqual({ ok: false, error: "not_found" });
    });

    it.each([
      ["no title", { ...CASE, title: " " }],
      ["no Coach context", { ...CASE, context: "" }],
      ["no message", { ...CASE, message: "" }],
      ["no criteria", { ...CASE, criteria: "" }],
      ["an item In view of an unknown kind", { ...CASE, inViewKind: "email" }],
      ["an item In view without its text", { ...CASE, inViewText: "" }],
      ["not a form", "Un cas"],
    ])("refuses a case with %s", async (_, input) => {
      expect(await evals.addCase(claire, "interview-psychology", input)).toEqual({ ok: false, error: "invalid" });
    });

    it("are only a Coaching Playbook's: neither the Core Digest nor the Sources list, nor a playbook that does not exist, has any", async () => {
      expect(await evals.addCase(claire, "core-digest", CASE)).toEqual({ ok: false, error: "not_found" });
      expect(await evals.addCase(claire, "salary-negotiation", CASE)).toEqual({ ok: false, error: "not_found" });
    });
  });

  describe("a Coaching Playbook's Eval Run", () => {
    const run = (input: unknown = {}) => evals.runPlaybook(claire, "interview-psychology", input);

    it("plays each Eval Case through the AI Coach's whole reply, made to consult that playbook at the version played, on the fictional Coach context", async () => {
      await evals.addCase(claire, "interview-psychology", CASE);

      const done = await run({ version: 1 });

      expect(done).toMatchObject({ ok: true, run: { subject: { kind: "coaching_playbook", playbookId: "interview-psychology", version: 1, agent, asSaved: true } } });
      const consulted = mistral.calls.find((call) => call.system?.includes('<playbook id="interview-psychology" version="1"'))!;
      expect(consulted.system).toContain("**R1. Respirez.** [S1]");
      expect(consulted.system).toContain("Le candidat s'appelle Paul");
      expect(consulted.system).toContain("DAF H/F chez Acme Industrie");
      expect(consulted).toMatchObject({ model: "mistral-medium-3-5", effort: "medium" });
      expect(consulted.messages).toEqual([{ role: "user", content: CASE.message }]);
      const reply = mistral.calls.find((call) => call.system?.startsWith("Tu es le coach Jobbbox"))!;
      expect(reply.system).toContain('<avis-playbook id="interview-psychology" version="1">');
      // Its Guardrails are played too, as they are.
      expect(mistral.calls.some((call) => call.system?.startsWith("Tu contrôles le message"))).toBe(true);
    });

    it("plays a draft version, the other playbooks served as they are", async () => {
      await evals.addCase(claire, "interview-psychology", CASE);
      await playbooks.save(claire, "interview-psychology", { content: "# Psychologie de l'entretien\n\n**R1. Souriez.** [S1]", ...agent });
      answers.advise = (input) => (input.system?.includes("Souriez") ? "Souriez [S1]." : "Respirez [S1].");
      const choices: string[] = [];
      const reply = answers.reply;
      answers.reply = (input) => {
        choices.push(input.system ?? "");
        return reply?.(input) ?? "Souriez.";
      };

      await run();

      const choice = mistral.calls.find((call) => call.system?.startsWith("Tu choisis quels Playbook Agents"))!;
      expect(choice.system).toContain("- interview-psychology : ");
      expect(choice.system).toContain("- ats-optimization : Quand il est question d'ATS.");
      expect(choices[0]).toContain("Souriez [S1].");
    });

    it("has the AI judge score each reply against its criteria, and records each case's result, an overall score, the cost and the response time", async () => {
      await evals.addCase(claire, "interview-psychology", CASE);
      await evals.addCase(claire, "interview-psychology", { ...CASE, title: "Second cas", criteria: "Vouvoie le candidat." });
      answers.judge = (input) => (String(input.messages[0]!.content).includes("Vouvoie") ? '{"score": 4, "raison": "Tutoie le candidat."}' : '{"score": 9, "raison": "Concret."}');

      const done = await run();
      if (!done.ok) throw new Error(done.error);

      expect(done.run).toMatchObject({
        judge: { provider: "openai" },
        startedBy: "claire@jobbbox.fr",
        startedAt: expect.any(Date),
        score: 65,
        costEur: expect.any(Number),
        responseMs: expect.any(Number),
      });
      expect(done.run.results).toEqual([
        expect.objectContaining({ case: expect.objectContaining({ title: CASE.title, criteria: CASE.criteria }), reply: expect.stringContaining("exemples chiffrés"), score: 0.9, reason: "Concret." }),
        expect.objectContaining({ case: expect.objectContaining({ title: "Second cas" }), score: 0.4, reason: "Tutoie le candidat." }),
      ]);
      const judged = judge.calls[0]!;
      expect(judged.messages[0]!.content).toContain(CASE.criteria);
      expect(judged.messages[0]!.content).toContain("<reponse>");
      expect(done.run.costEur).toBeGreaterThan(0);
    });

    it("runs every AI call on the eval task, for no Candidate, counted in AI Usage; the AI judge may be outside the EU, the AI Coach is not", async () => {
      await evals.addCase(claire, "interview-psychology", CASE);

      await run();

      expect(usage.entries.length).toBeGreaterThan(3);
      expect(new Set(usage.entries.map((entry) => entry.task))).toEqual(new Set(["eval"]));
      expect(new Set(usage.entries.map((entry) => entry.candidateId))).toEqual(new Set([null]));
      expect(usage.entries.filter((entry) => entry.provider === "openai")).toHaveLength(1);
    });

    it("is dated and kept with the text of the cases it played, whatever happens to them after", async () => {
      const added = await evals.addCase(claire, "interview-psychology", CASE);
      if (!added.ok) throw new Error(added.error);
      const done = await run();
      if (!done.ok) throw new Error(done.error);

      await evals.saveCase(claire, "interview-psychology", added.evalCase.id, { ...CASE, message: "Autre message" });
      await evals.removeCase("interview-psychology", added.evalCase.id);

      const kept = await evals.run(done.run.id);
      expect(kept?.results[0]).toMatchObject({ case: { message: CASE.message, criteria: CASE.criteria } });
      expect((await evals.runs({ playbookId: "interview-psychology" })).map((each) => each.id)).toEqual([done.run.id]);
    });

    it("compares models and efforts: a draft played once per choice, on EU-resident models the AI layer offers only", async () => {
      await evals.addCase(claire, "interview-psychology", CASE);

      const large = await run({ provider: "mistral", model: "mistral-large-latest", effort: "high" });
      const outsideEu = await run({ provider: "openai", model: "gpt-5", effort: "high" });

      expect(large).toMatchObject({ ok: true, run: { subject: { agent: { model: "mistral-large-latest", effort: "high", consultWhen: agent.consultWhen }, asSaved: false } } });
      expect(mistral.calls.some((call) => call.model === "mistral-large-latest" && call.effort === "high")).toBe(true);
      expect(outsideEu).toEqual({ ok: false, error: "model_not_allowed" });
    });

    it("needs Eval Cases, a Coaching Playbook and one of its versions", async () => {
      expect(await run()).toEqual({ ok: false, error: "no_cases" });
      expect(await evals.runPlaybook(claire, "core-digest", {})).toEqual({ ok: false, error: "not_found" });
      await evals.addCase(claire, "interview-psychology", CASE);
      expect(await run({ version: 7 })).toEqual({ ok: false, error: "not_found" });
      expect(await run({ effort: "max" })).toEqual({ ok: false, error: "invalid" });
    });

    it("counts a case the AI Coach could not reply to, or the judge could not score, in no score", async () => {
      await evals.addCase(claire, "interview-psychology", CASE);
      answers.judge = () => "Je ne sais pas.";

      const done = await run();

      expect(done).toMatchObject({ ok: true, run: { score: null, results: [{ score: null }] } });
    });

    it("is what a Playbook Version needs to be Human-validated: one on it as it now is; no score blocks it", async () => {
      await evals.addCase(claire, "interview-psychology", CASE);
      answers.judge = () => '{"score": 0, "raison": "Rien ne va."}';

      expect(await playbooks.validate(paul, "interview-psychology", 1)).toEqual({ ok: false, error: "no_eval_run" });
      await run({ version: 1, model: "mistral-large-latest" });
      expect(await playbooks.validate(paul, "interview-psychology", 1)).toEqual({ ok: false, error: "no_eval_run" });
      const played = await run({ version: 1 });
      await playbooks.save(claire, "interview-psychology", { content: "# Psychologie de l'entretien\n\n**R1. Souriez.** [S1]", ...agent });
      expect(await playbooks.validate(paul, "interview-psychology", 1)).toEqual({ ok: false, error: "no_eval_run" });
      await run({ version: 1 });

      expect(await playbooks.validate(paul, "interview-psychology", 1)).toMatchObject({ ok: true });
      expect(played).toMatchObject({ ok: true, run: { score: 0 } });
    });

    it("lets the validator read the run on the version to validate beside the run on the served version", async () => {
      await evals.addCase(claire, "interview-psychology", CASE);
      const first = await run({ version: 1 });
      await playbooks.validate(paul, "interview-psychology", 1);
      await playbooks.save(claire, "interview-psychology", { content: "# Psychologie de l'entretien\n\n**R1. Souriez.** [S1]", ...agent });
      const second = await run({ version: 2 });
      const history = (await playbooks.history("interview-psychology"))!;

      expect((await evals.playedOn(history.playbook.latest))?.id).toBe(second.ok && second.run.id);
      expect((await evals.playedOn(history.versions.find((each) => each.version === 1)!))?.id).toBe(first.ok && first.run.id);
      // The cases belong to the playbook: the new version kept them.
      expect(await evals.cases("interview-psychology")).toHaveLength(1);
    });
  });
});
