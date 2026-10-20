import type { AgentModelChoice } from "@jobhub/ai";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createThrowawayDatabase, type ThrowawayDatabase } from "../test-support/throwaway-database";
import { importedPlaybooks } from "./import";
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

/** The EU-resident models the AI layer offers in these tests. */
const MODELS: AgentModelChoice[] = [
  { provider: "mistral", endpoint: "api.mistral.ai", models: [{ model: "mistral-large-latest", effort: "ignored" }, { model: "mistral-medium-3-5", effort: "medium_as_high" }] },
  { provider: "anthropic", endpoint: "bedrock eu-west-3", models: [{ model: "anthropic.claude-opus-5-5", effort: "native" }] },
];

const SOURCES = ["# Sources", "", "| ID | Titre | Auteur | Année | URL | Licence |", "|--|--|--|--|--|--|", "| S1 | Étude 1 | Apec | 2026 | https://apec.fr/1 | publique |", "| S2 | Étude 2 | Dares | 2025 | https://dares.fr/2 | publique |", "| S3 | Étude 3 | OCDE | 2019 | https://oecd.org/3 | publique |"].join("\n");

const agent = { provider: "mistral" as const, model: "mistral-medium-3-5", effort: "medium" as const, consultWhen: "Quand le candidat prépare un entretien." };

const SEED: PlaybookSeed = {
  sources: SOURCES,
  coreDigest: "# Socle\n\n- Jamais de promesse de résultat [S1].",
  playbooks: [
    { id: "interview-psychology", content: "# Psychologie de l'entretien\n\n**R1. Respirez.** [S2]", agent },
    { id: "ats-optimization", content: "# Optimiser son CV pour les ATS\n\n**R1. Des mots-clés.** [S1]", agent: { ...agent, consultWhen: "Quand il est question d'ATS." } },
  ],
};

const claire = { email: "claire@jobbbox.fr" };
const paul = { email: "paul@jobbbox.fr", name: "Paul Martin" };

describe.skipIf(!connectionString)("Coaching Playbooks, versioned in the database (needs Postgres: DATABASE_URL)", () => {
  let throwaway: ThrowawayDatabase;
  let database: Pool;
  /** Every version has had its Eval Run here: what validation needs of it is tested in evals/. */
  const playbooksFor = (serving: PlaybookServing) => createCoachingPlaybooks(database, { serving, agentModels: () => MODELS, evalRunOn: async () => true });
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

      expect(listed.map((playbook) => [playbook.id, playbook.kind, playbook.latest.version, playbook.latest.validation])).toEqual([
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

    it("lets a Playbook Agent use only an EU-resident model the AI layer offers", async () => {
      expect(await playbooks.save(claire, "ats-optimization", { content: "# ATS", ...agent, provider: "openai", model: "gpt-5" })).toEqual({ ok: false, error: "model_not_allowed" });
      expect(await playbooks.save(claire, "ats-optimization", { content: "# ATS", ...agent, model: "mistral-tiny" })).toEqual({ ok: false, error: "model_not_allowed" });
      expect(await playbooks.save(claire, "ats-optimization", { content: "# ATS", ...agent, provider: "anthropic", model: "anthropic.claude-opus-5-5" })).toMatchObject({ ok: true });
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
});
