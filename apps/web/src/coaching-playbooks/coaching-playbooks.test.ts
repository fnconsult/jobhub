import type { AgentModelChoice } from "@jobhub/ai";
import { builtInInstructions, TASK_PLAYBOOKS } from "@jobhub/coach-knowledge/tasks";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createThrowawayDatabase, type ThrowawayDatabase } from "../test-support/throwaway-database";
import { importedPlaybooks, IMPORT_VALIDATOR } from "./import";
import {
  CORE_DIGEST,
  createCoachingPlaybooks,
  migrateCoachingPlaybooks,
  SOURCES_LIST,
  type CoachingPlaybooks,
  type PlaybookSeed,
  type PlaybookServing,
} from "./index";

const connectionString = process.env.DATABASE_URL;

/** The text models the AI layer offers in these tests, one outside the EU. */
const MODELS: AgentModelChoice[] = [
  { provider: "mistral", endpoint: "api.mistral.ai", residency: "eu", models: [{ model: "mistral-large-latest", effort: "ignored", residency: "eu" }, { model: "mistral-medium-3-5", effort: "medium_as_high", residency: "eu" }] },
  { provider: "anthropic", endpoint: "bedrock eu-west-3", residency: "eu", models: [{ model: "anthropic.claude-opus-5-5", effort: "native", residency: "eu" }] },
  { provider: "openai", endpoint: "api.openai.com", residency: "outside_eu", models: [{ model: "gpt-5", effort: "native", residency: "outside_eu" }] },
];

/** The web-search providers the AI layer offers in these tests (ADR-0026). */
const SEARCH_MODELS: AgentModelChoice[] = [
  { provider: "perplexity", endpoint: "api.perplexity.ai", residency: "outside_eu", defaultModel: "sonar", models: [{ model: "sonar", effort: "ignored", residency: "outside_eu" }] },
  { provider: "tavily", endpoint: "api.tavily.com", residency: "outside_eu", defaultModel: "basic", models: [{ model: "basic", effort: "ignored", residency: "outside_eu" }, { model: "advanced", effort: "ignored", residency: "outside_eu" }] },
];

const SOURCES = ["# Sources", "", "| ID | Titre | Auteur | Année | URL | Licence |", "|--|--|--|--|--|--|", "| S1 | Étude 1 | Apec | 2026 | https://apec.fr/1 | publique |", "| S2 | Étude 2 | Dares | 2025 | https://dares.fr/2 | publique |", "| S3 | Étude 3 | OCDE | 2019 | https://oecd.org/3 | publique |"].join("\n");

const agent = { provider: "mistral" as const, model: "mistral-medium-3-5", effort: "medium" as const, consultWhen: "Quand le candidat prépare un entretien." };

/** A task Playbook's Playbook Agent: no effort (the model's own), never consulted by the AI Coach. */
const taskAgent = { provider: "mistral" as const, model: "mistral-medium-3-5", effort: null, consultWhen: "" };

const SEED: PlaybookSeed = {
  sources: SOURCES,
  coreDigest: "# Socle\n\n- Jamais de promesse de résultat [S1].",
  playbooks: [
    { id: "interview-psychology", content: "# Psychologie de l'entretien\n\n**R1. Respirez.** [S2]", agent },
    { id: "ats-optimization", content: "# Optimiser son CV pour les ATS\n\n**R1. Des mots-clés.** [S1]", agent: { ...agent, consultWhen: "Quand il est question d'ATS." } },
  ],
  tasks: [
    { id: "cv-reading", content: builtInInstructions("cv-reading"), agent: taskAgent, validatedBy: "François Nader" },
    { id: "job-offer-reading", content: builtInInstructions("job-offer-reading"), agent: taskAgent, validatedBy: null },
    { id: "tailored-cv", content: builtInInstructions("tailored-cv"), agent: taskAgent, validatedBy: "François Nader" },
    { id: "company-facts-search", content: builtInInstructions("company-facts-search"), agent: null, validatedBy: "François Nader" },
  ],
};

const claire = { email: "claire@jobbbox.fr" };
const paul = { email: "paul@jobbbox.fr", name: "Paul Martin" };

describe.skipIf(!connectionString)("Coaching Playbooks, versioned in the database (needs Postgres: DATABASE_URL)", () => {
  let throwaway: ThrowawayDatabase;
  let database: Pool;
  /** Every version has had its Eval Run here: what validation needs of it is tested in evals/. */
  const playbooksFor = (serving: PlaybookServing) =>
    createCoachingPlaybooks(database, { serving, agentModels: () => MODELS, searchModels: () => SEARCH_MODELS, evalRunOn: async () => true });
  let playbooks: CoachingPlaybooks;

  beforeEach(async () => {
    throwaway = await createThrowawayDatabase("test_coaching_playbooks");
    database = throwaway.pool;
    await migrateCoachingPlaybooks(database, () => SEED);
    playbooks = playbooksFor("latest");
  }, 60_000);
  afterEach(async () => {
    await throwaway.drop();
  }, 60_000);

  const servedIds = async (each: CoachingPlaybooks) => (await each.served()).playbooks.map((playbook) => `${playbook.id} v${playbook.version}`);

  describe("the one-off import", () => {
    it("makes version 1 of each Coaching Playbook, of the Core Digest and of the Sources list, none of them Human-validated", async () => {
      const listed = await playbooks.list();

      expect(listed.filter((playbook) => playbook.kind !== "task").map((playbook) => [playbook.id, playbook.kind, playbook.latest.version, playbook.latest.validation])).toEqual([
        [CORE_DIGEST, "core_digest", 1, null],
        [SOURCES_LIST, "sources", 1, null],
        ["ats-optimization", "playbook", 1, null],
        ["interview-psychology", "playbook", 1, null],
      ]);
      expect(listed.find((playbook) => playbook.id === "interview-psychology")).toMatchObject({ title: "Psychologie de l'entretien", archived: false, latest: { agent, authors: ["import"] } });
    });

    it("runs once: migrating again keeps what was changed since", async () => {
      await playbooks.save(claire, "ats-optimization", { content: "# ATS\n\n**R1. Autre.** [S1]", ...agent });
      await migrateCoachingPlaybooks(database, () => SEED);

      expect((await playbooks.list()).find((playbook) => playbook.id === "ats-optimization")?.latest.content).toBe("# ATS\n\n**R1. Autre.** [S1]");
    });

    it("of today's files gives each playbook a default Playbook Agent: the AI Coach's route, effort medium, when to consult it from the Playbook table", () => {
      const seed = importedPlaybooks({ AI_COACHING_PROVIDER: "mistral", AI_COACHING_MODEL: "mistral-medium-3-5" });

      expect(seed.playbooks).toHaveLength(10);
      for (const playbook of seed.playbooks) {
        expect(playbook.agent, playbook.id).toMatchObject({ provider: "mistral", model: "mistral-medium-3-5", effort: "medium" });
        expect(playbook.agent.consultWhen.length, playbook.id).toBeGreaterThan(40);
      }
      expect(seed.playbooks.find((playbook) => playbook.id === "freelance-mission-positioning")?.agent.consultWhen).toMatch(/portage/);
      expect(seed.coreDigest).toMatch(/^# Socle de coaching/);
      expect(seed.sources).toMatch(/\| S56 \|/);
      // No model set for the AI Coach: the provider's default model.
      expect(importedPlaybooks({}).playbooks[0]!.agent).toMatchObject({ provider: "anthropic", model: null });
    });
  });

  describe("saving a Playbook Version", () => {
    it("edits a version not yet Human-validated in place, noting each author", async () => {
      const saved = await playbooks.save(claire, "ats-optimization", { content: "# ATS\n\n**R1. Nouveau.** [S1]", ...agent, effort: "high" });

      expect(saved).toMatchObject({ ok: true, newVersion: false, before: { version: 1, agent: { effort: "medium" } }, version: { version: 1, agent: { effort: "high" }, authors: ["import", "claire@jobbbox.fr"] } });
    });

    it("makes a new version once the latest is Human-validated, the validated one kept as it was", async () => {
      await playbooks.validate(paul, "ats-optimization", 1);

      const saved = await playbooks.save(claire, "ats-optimization", { content: "# ATS\n\n**R1. Nouveau.** [S1]", ...agent });

      expect(saved).toMatchObject({ ok: true, newVersion: true, version: { version: 2, validation: null, authors: ["claire@jobbbox.fr"] } });
      const history = await playbooks.history("ats-optimization");
      expect(history?.versions.map((version) => [version.version, version.content, version.validation?.name ?? null])).toEqual([
        [2, "# ATS\n\n**R1. Nouveau.** [S1]", null],
        [1, SEED.playbooks[1]!.content, "Paul Martin"],
      ]);
    });

    it("makes a new version when only the Playbook Agent changes", async () => {
      await playbooks.validate(paul, "ats-optimization", 1);

      expect(await playbooks.save(claire, "ats-optimization", { content: SEED.playbooks[1]!.content, ...agent, consultWhen: "Quand il est question d'ATS.", model: "" })).toMatchObject({
        ok: true,
        version: { version: 2, agent: { provider: "mistral", model: null } },
      });
    });

    it("creates nothing when nothing changed", async () => {
      expect(await playbooks.save(claire, "ats-optimization", { content: SEED.playbooks[1]!.content, ...agent, consultWhen: "Quand il est question d'ATS." })).toEqual({ ok: false, error: "unchanged" });
    });

    it("refuses a citation missing from the Sources list, naming it", async () => {
      expect(await playbooks.save(claire, "ats-optimization", { content: "# ATS [S1][S9][S12]", ...agent })).toEqual({ ok: false, error: "unknown_sources", sources: ["S9", "S12"] });
      expect(await playbooks.save(claire, CORE_DIGEST, { content: "# Socle [S4]" })).toEqual({ ok: false, error: "unknown_sources", sources: ["S4"] });
    });

    it.each([
      ["an empty text", { content: " ", ...agent }],
      ["an effort that is not low, medium or high", { content: "# ATS", ...agent, effort: "max" }],
      ["no description of when to consult it", { content: "# ATS", ...agent, consultWhen: "" }],
      ["not a form", "# ATS"],
    ])("refuses %s", async (_, input) => {
      expect(await playbooks.save(claire, "ats-optimization", input)).toEqual({ ok: false, error: "invalid" });
    });

    it("lets a Playbook Agent use only a model the AI layer offers, outside the EU too", async () => {
      expect(await playbooks.save(claire, "ats-optimization", { content: "# ATS", ...agent, provider: "openai", model: "gpt-4" })).toEqual({ ok: false, error: "model_not_allowed" });
      expect(await playbooks.save(claire, "ats-optimization", { content: "# ATS", ...agent, provider: "perplexity", model: "" })).toEqual({ ok: false, error: "model_not_allowed" });
      expect(await playbooks.save(claire, "ats-optimization", { content: "# ATS", ...agent, model: "mistral-tiny" })).toEqual({ ok: false, error: "model_not_allowed" });
      expect(await playbooks.save(claire, "ats-optimization", { content: "# ATS", ...agent, provider: "anthropic", model: "anthropic.claude-opus-5-5" })).toMatchObject({ ok: true });
      expect(await playbooks.save(claire, "ats-optimization", { content: "# ATS", ...agent, provider: "openai", model: "gpt-5" })).toMatchObject({ ok: true, version: { agent: { provider: "openai", model: "gpt-5" } } });
    });

    it("says when a playbook does not exist", async () => {
      expect(await playbooks.save(claire, "salary-negotiation", { content: "# Salaire", ...agent })).toEqual({ ok: false, error: "not_found" });
    });
  });

  describe("the Sources list", () => {
    it("can lose a source no playbook cites", async () => {
      expect(await playbooks.save(claire, SOURCES_LIST, { content: SOURCES.replace(/\n\| S3 .*$/, "") })).toMatchObject({ ok: true });
    });

    it("cannot lose a source a served version cites: the refusal lists the playbooks citing it", async () => {
      const withoutS1 = SOURCES.split("\n").filter((line) => !line.startsWith("| S1 ")).join("\n");

      expect(await playbooks.save(claire, SOURCES_LIST, { content: withoutS1 })).toEqual({
        ok: false,
        error: "sources_cited",
        citedBy: [{ source: "S1", playbooks: [CORE_DIGEST, "ats-optimization"] }],
      });
    });

    it("can lose a source only an archived playbook cites", async () => {
      await playbooks.setArchived("interview-psychology", true);

      expect(await playbooks.save(claire, SOURCES_LIST, { content: SOURCES.replace(/\n\| S2 .*$/m, "") })).toMatchObject({ ok: true });
    });

    it("refuses a list without a source, or one listing a source twice", async () => {
      expect(await playbooks.save(claire, SOURCES_LIST, { content: "# Sources" })).toEqual({ ok: false, error: "invalid" });
      expect(await playbooks.save(claire, SOURCES_LIST, { content: `${SOURCES}\n| S3 | Encore | OCDE | 2019 | https://oecd.org/3 | publique |` })).toEqual({ ok: false, error: "invalid" });
    });
  });

  describe("Human validation", () => {
    it("is given by a named Administrator other than the version's author, with their name and the date", async () => {
      await playbooks.save(claire, "ats-optimization", { content: "# ATS\n\n**R1. Nouveau.** [S1]", ...agent });

      expect(await playbooks.validate({ email: "Claire@jobbbox.fr", name: "Claire" }, "ats-optimization", 1)).toEqual({ ok: false, error: "own_version" });
      const validated = await playbooks.validate(paul, "ats-optimization", 1);

      expect(validated).toMatchObject({ ok: true, version: { version: 1, validation: { name: "Paul Martin", email: "paul@jobbbox.fr", at: expect.any(Date) } } });
    });

    it("is given once, to the latest version only", async () => {
      await playbooks.validate(paul, "ats-optimization", 1);
      expect(await playbooks.validate(paul, "ats-optimization", 1)).toEqual({ ok: false, error: "already_validated" });
      await playbooks.save(claire, "ats-optimization", { content: "# ATS v2 [S1]", ...agent });
      await playbooks.save(claire, "ats-optimization", { content: "# ATS v2 bis [S1]", ...agent });

      expect(await playbooks.validate(paul, "ats-optimization", 1)).toEqual({ ok: false, error: "not_latest" });
      expect(await playbooks.validate(paul, "ats-optimization", 3)).toEqual({ ok: false, error: "not_found" });
    });
  });

  describe("what is served to the AI Coach", () => {
    it("in production: only the latest Human-validated version of each", async () => {
      const production = playbooksFor("validated");
      expect(await production.served()).toEqual({ coreDigest: null, sources: null, playbooks: [] });

      await production.validate(paul, "ats-optimization", 1);
      await production.save(claire, "ats-optimization", { content: "# ATS v2 [S1]", ...agent });
      await production.validate(paul, CORE_DIGEST, 1);
      await production.validate(paul, SOURCES_LIST, 1);

      const served = await production.served();
      expect(served.coreDigest).toEqual({ version: 1, content: SEED.coreDigest });
      expect(served.sources?.entries.map((source) => source.id)).toEqual(["S1", "S2", "S3"]);
      expect(served.playbooks).toEqual([{ id: "ats-optimization", title: "Optimiser son CV pour les ATS", version: 1, content: SEED.playbooks[1]!.content, agent: SEED.playbooks[1]!.agent }]);
      expect((await production.list()).find((playbook) => playbook.id === "ats-optimization")).toMatchObject({ latest: { version: 2 }, served: { version: 1 } });
    });

    it("elsewhere: the latest version of each, validated or not", async () => {
      await playbooks.validate(paul, "ats-optimization", 1);
      await playbooks.save(claire, "ats-optimization", { content: "# ATS v2 [S1]", ...agent });

      expect(await servedIds(playbooks)).toEqual(["ats-optimization v2", "interview-psychology v1"]);
      expect((await playbooks.served()).coreDigest?.version).toBe(1);
    });

    it("never an archived Coaching Playbook, which is kept with its versions and can be restored", async () => {
      expect(await playbooks.setArchived("interview-psychology", true)).toEqual({ ok: true, changed: true, version: 1 });
      expect(await playbooks.setArchived("interview-psychology", true)).toEqual({ ok: true, changed: false, version: 1 });

      expect(await servedIds(playbooks)).toEqual(["ats-optimization v1"]);
      expect((await playbooks.history("interview-psychology"))?.playbook).toMatchObject({ archived: true, served: null, latest: { version: 1 } });

      await playbooks.setArchived("interview-psychology", false);
      expect(await servedIds(playbooks)).toEqual(["ats-optimization v1", "interview-psychology v1"]);
    });

    it("always has a Core Digest and a Sources list, which cannot be archived", async () => {
      expect(await playbooks.setArchived(CORE_DIGEST, true)).toEqual({ ok: false, error: "not_archivable" });
      expect(await playbooks.setArchived(SOURCES_LIST, true)).toEqual({ ok: false, error: "not_archivable" });
      expect(await playbooks.setArchived("salary-negotiation", true)).toEqual({ ok: false, error: "not_found" });
    });
  });

  describe("a new Coaching Playbook", () => {
    it("starts at version 1, by its author, not validated", async () => {
      const created = await playbooks.create(claire, { id: "salary-negotiation", content: "# Négocier son salaire\n\n**R1. Visez haut.** [S3]", ...agent });

      expect(created).toMatchObject({ ok: true, version: { playbookId: "salary-negotiation", version: 1, authors: ["claire@jobbbox.fr"], validation: null } });
      expect(await servedIds(playbooks)).toContain("salary-negotiation v1");
    });

    it("refuses an id taken, reserved or not made of lower-case words", async () => {
      expect(await playbooks.create(claire, { id: "ats-optimization", content: "# ATS", ...agent })).toEqual({ ok: false, error: "exists" });
      expect(await playbooks.create(claire, { id: CORE_DIGEST, content: "# Socle", ...agent })).toEqual({ ok: false, error: "exists" });
      expect(await playbooks.create(claire, { id: "Salaire !", content: "# Salaire", ...agent })).toEqual({ ok: false, error: "invalid" });
      expect(await playbooks.create(claire, { id: "salaire", content: "# Salaire [S77]", ...agent })).toEqual({ ok: false, error: "unknown_sources", sources: ["S77"] });
    });
  });

  describe("task Playbooks (ADR-0026)", () => {
    const taskIds = async (each: CoachingPlaybooks) => (await each.list()).filter((playbook) => playbook.kind === "task").map((playbook) => playbook.id);
    /** A task Playbook's form: its text and the model running it, no effort ("": the model's own), no "when to consult it". */
    const taskForm = (content: string, fields: Record<string, string> = {}) => ({ content, provider: "mistral", model: "mistral-medium-3-5", effort: "", ...fields });

    it("are imported as version 1 by \"import\": the existing tasks Human-validated under the name given, the Job Offer Summary's not", async () => {
      const listed = (await playbooks.list()).filter((playbook) => playbook.kind === "task");

      // Listed after the coaching knowledge, in the order the code lists its tasks, titled as the code names them.
      expect(listed.map((playbook) => playbook.id)).toEqual(["job-offer-reading", "cv-reading", "tailored-cv", "company-facts-search"]);
      expect(listed.find((playbook) => playbook.id === "cv-reading")).toMatchObject({
        title: "Lire un CV importé",
        latest: { version: 1, authors: ["import"], agent: taskAgent, validation: { name: "François Nader", email: "import" } },
      });
      expect(listed.find((playbook) => playbook.id === "job-offer-reading")).toMatchObject({ title: "Lire une offre d'emploi : résumé et secteur", latest: { validation: null } });
      expect(listed.find((playbook) => playbook.id === "company-facts-search")?.latest).toMatchObject({ agent: null, search: null });
    });

    it("of the code's tasks: each existing one validated by François Nader, run on the task's route with no effort, a web-search query by no Playbook Agent", () => {
      const { tasks } = importedPlaybooks({ AI_WRITING_PROVIDER: "mistral", AI_WRITING_MODEL: "mistral-medium-3-5" });

      expect(tasks.map((task) => task.id)).toEqual(TASK_PLAYBOOKS.map((task) => task.id));
      expect(tasks.filter((task) => task.validatedBy === null).map((task) => task.id)).toEqual(["job-offer-reading"]);
      expect(tasks.find((task) => task.id === "cv-reading")?.validatedBy).toBe(IMPORT_VALIDATOR);
      expect(IMPORT_VALIDATOR).toBe("François Nader");
      expect(tasks.find((task) => task.id === "tailored-cv")?.agent).toEqual({ provider: "mistral", model: "mistral-medium-3-5", effort: null, consultWhen: "" });
      expect(tasks.find((task) => task.id === "cv-reading")?.agent).toMatchObject({ provider: "anthropic", model: null, effort: null });
      expect(tasks.filter((task) => task.agent === null).map((task) => task.id)).toEqual(["company-facts-search", "company-news-search"]);
      for (const task of tasks) expect(task.content, task.id).toBe(builtInInstructions(task.id as never));
    });

    it("are added, once, to a database migrated before they existed, leaving its coaching knowledge as it was", async () => {
      const old = await createThrowawayDatabase("test_task_playbooks_seed");
      try {
        // A database migrated before task Playbooks: the coaching knowledge only, and the kinds it allowed then.
        await migrateCoachingPlaybooks(old.pool, () => ({ ...SEED, tasks: [] }));
        await old.pool.query(`ALTER TABLE coaching_playbook DROP CONSTRAINT coaching_playbook_kind_check;
          ALTER TABLE coaching_playbook ADD CONSTRAINT coaching_playbook_kind_check CHECK (kind IN ('playbook', 'core_digest', 'sources'))`);
        const before = createCoachingPlaybooks(old.pool, { serving: "latest", agentModels: () => MODELS, evalRunOn: async () => true });
        await before.save(claire, "ats-optimization", { content: "# ATS\n\n**R1. Autre.** [S1]", ...agent });

        await migrateCoachingPlaybooks(old.pool, () => SEED);
        const after = createCoachingPlaybooks(old.pool, { serving: "validated", agentModels: () => MODELS, evalRunOn: async () => true });
        expect(await taskIds(after)).toEqual(["job-offer-reading", "cv-reading", "tailored-cv", "company-facts-search"]);
        expect((await after.list()).find((playbook) => playbook.id === "ats-optimization")?.latest.content).toBe("# ATS\n\n**R1. Autre.** [S1]");
        expect(await after.servedTask("cv-reading")).toMatchObject({ version: 1, content: builtInInstructions("cv-reading") });

        // Safe to run again: a task Playbook changed since is kept, none is added twice, a new one is added.
        await after.save(claire, "cv-reading", taskForm("Lis le CV."));
        await migrateCoachingPlaybooks(old.pool, () => ({ ...SEED, tasks: [...SEED.tasks, { id: "coach-memory", content: builtInInstructions("coach-memory"), agent: taskAgent, validatedBy: "François Nader" }] }));
        await migrateCoachingPlaybooks(old.pool, () => SEED);
        expect((await after.history("cv-reading"))?.versions.map((version) => [version.version, version.content])).toEqual([
          [2, "Lis le CV."],
          [1, builtInInstructions("cv-reading")],
        ]);
        expect(await taskIds(after)).toEqual(["job-offer-reading", "cv-reading", "tailored-cv", "coach-memory", "company-facts-search"]);
      } finally {
        await old.drop();
      }
    }, 60_000);

    it("are never served to the AI Coach, nor chosen as its Playbook Agents", async () => {
      expect((await playbooks.served()).playbooks.map((playbook) => playbook.id)).toEqual(["ats-optimization", "interview-psychology"]);
    });

    it("serve, in production, the latest Human-validated version: none for the Job Offer Summary until a person validates it", async () => {
      const production = playbooksFor("validated");
      expect(await production.servedTask("job-offer-reading")).toBeNull();
      expect(await production.servedTask("cv-reading")).toEqual({ id: "cv-reading", version: 1, content: builtInInstructions("cv-reading"), agent: taskAgent, search: null });

      // A change makes version 2, not served until validated by someone other than its author.
      await production.save(claire, "cv-reading", taskForm("Lis le CV.", { effort: "high" }));
      expect(await production.servedTask("cv-reading")).toMatchObject({ version: 1 });
      expect(await production.validate({ ...claire, name: "Claire" }, "cv-reading", 2)).toEqual({ ok: false, error: "own_version" });
      await production.validate(paul, "cv-reading", 2);
      expect(await production.servedTask("cv-reading")).toEqual({ id: "cv-reading", version: 2, content: "Lis le CV.", agent: { ...taskAgent, effort: "high" }, search: null });

      await production.validate(paul, "job-offer-reading", 1);
      expect(await production.servedTask("job-offer-reading")).toMatchObject({ version: 1, content: builtInInstructions("job-offer-reading") });
    });

    it("serve, elsewhere, the latest version, validated or not; none when archived, nor for an id that is no task Playbook", async () => {
      expect(await playbooks.servedTask("job-offer-reading")).toMatchObject({ version: 1 });
      await playbooks.save(claire, "job-offer-reading", taskForm("- \"summary\" : une phrase."));
      expect(await playbooks.servedTask("job-offer-reading")).toMatchObject({ version: 1, content: '- "summary" : une phrase.' });

      expect(await playbooks.setArchived("job-offer-reading", true)).toEqual({ ok: true, changed: true, version: 1 });
      expect(await playbooks.servedTask("job-offer-reading")).toBeNull();
      expect(await playbooks.servedTask("ats-optimization")).toBeNull();
      expect(await playbooks.servedTask("core-digest")).toBeNull();
    });

    it("take a Playbook Agent with no \"when to consult it\", and an effort or none; a web-search query takes none", async () => {
      expect(await playbooks.save(claire, "cv-reading", taskForm("Lis le CV.", { consultWhen: "Jamais lu" }))).toMatchObject({
        ok: true,
        newVersion: true,
        version: { version: 2, agent: { provider: "mistral", model: "mistral-medium-3-5", effort: null, consultWhen: "" } },
      });
      expect(await playbooks.save(claire, "cv-reading", taskForm("Lis le CV.", { effort: "max" }))).toEqual({ ok: false, error: "invalid" });
      expect(await playbooks.save(claire, "cv-reading", taskForm("Lis le CV.", { provider: "openai", model: "gpt-4" }))).toEqual({ ok: false, error: "model_not_allowed" });
      expect(await playbooks.save(claire, "company-facts-search", { content: "Qui est {{entreprise}} ?", provider: "mistral" })).toMatchObject({ ok: true, version: { agent: null } });
    });

    it("searching the web, take a web-search provider and model among those offered; none is the configured web-search route", async () => {
      const facts = "Qui est {{entreprise}} ?";
      expect(await playbooks.save(claire, "company-facts-search", { content: facts, searchProvider: "tavily", searchModel: "advanced" })).toMatchObject({
        ok: true,
        version: { version: 2, agent: null, search: { provider: "tavily", model: "advanced" } },
      });
      expect(await playbooks.servedTask("company-facts-search")).toMatchObject({ search: { provider: "tavily", model: "advanced" } });
      // Imported Human-validated: the change made version 2, then edited in place.
      expect(await playbooks.save(claire, "company-facts-search", { content: facts, searchProvider: "perplexity", searchModel: "" })).toMatchObject({ ok: true, version: { search: { provider: "perplexity", model: null } } });
      expect(await playbooks.save(claire, "company-facts-search", { content: facts, searchProvider: "", searchModel: "" })).toMatchObject({ ok: true, version: { search: null } });

      expect(await playbooks.save(claire, "company-facts-search", { content: facts, searchProvider: "tavily", searchModel: "ultra" })).toEqual({ ok: false, error: "model_not_allowed" });
      expect(await playbooks.save(claire, "company-facts-search", { content: facts, searchProvider: "brave" })).toEqual({ ok: false, error: "model_not_allowed" });
      expect(await playbooks.save(claire, "company-facts-search", { content: facts, searchProvider: "mistral" })).toEqual({ ok: false, error: "model_not_allowed" });
      expect(await playbooks.save(claire, "company-facts-search", { content: facts, searchProvider: "bing" })).toEqual({ ok: false, error: "invalid" });
      // A task that runs no web search keeps none, whatever the form says.
      expect(await playbooks.save(claire, "cv-reading", taskForm("Lis le CV.", { searchProvider: "tavily" }))).toMatchObject({ ok: true, version: { search: null } });
    });

    it("make a new version, once Human-validated, when only the web-search provider changes; none when it stays", async () => {
      const content = builtInInstructions("company-facts-search");
      expect(await playbooks.save(claire, "company-facts-search", { content })).toEqual({ ok: false, error: "unchanged" });

      expect(await playbooks.save(claire, "company-facts-search", { content, searchProvider: "tavily" })).toMatchObject({ ok: true, newVersion: true, version: { version: 2, search: { provider: "tavily", model: null } } });
      expect(await playbooks.save(claire, "company-facts-search", { content, searchProvider: "tavily" })).toEqual({ ok: false, error: "unchanged" });
      expect((await playbooks.history("company-facts-search"))?.versions.map((version) => version.search)).toEqual([{ provider: "tavily", model: null }, null]);
    });

    it("refuse a text lacking a section or a {{slot}} its task reads, or too long for a web-search query", async () => {
      expect(await playbooks.save(claire, "tailored-cv", taskForm("## fr\n\nAdapte le CV."))).toEqual({ ok: false, error: "task_instructions", problems: ["## en"] });
      expect(await playbooks.save(claire, "company-facts-search", { content: "Qui est cette entreprise ?" })).toEqual({ ok: false, error: "task_instructions", problems: ["{{entreprise}}"] });
      expect(await playbooks.save(claire, "company-facts-search", { content: `{{entreprise}} ${"x".repeat(600)}` })).toEqual({ ok: false, error: "task_instructions", problems: ["length"] });
      // A task Playbook cites no Source: "[S9]" is just text.
      expect(await playbooks.save(claire, "cv-reading", taskForm("Lis le CV [S9]."))).toMatchObject({ ok: true });
    });

    it("are never created in the Back Office: their ids stay the code's", async () => {
      expect(await playbooks.create(claire, { id: "cv-reading", content: "# CV", ...agent })).toEqual({ ok: false, error: "exists" });
      expect(await playbooks.create(claire, { id: "coach-memory", content: "# Mémoire", ...agent })).toEqual({ ok: false, error: "exists" });
    });
  });
});
