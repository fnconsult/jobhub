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

    it("belong to the playbook, not to a Playbook Version: a new version keeps them, with no validation of their own", async () => {
      await evals.addCase(claire, "interview-psychology", CASE);
      await playbooks.validate(paul, "interview-psychology", 1).catch(() => null);
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
});
