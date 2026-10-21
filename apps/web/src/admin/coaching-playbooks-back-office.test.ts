import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createCoachingPlaybooks, migrateCoachingPlaybooks, type CoachingPlaybooks } from "../coaching-playbooks";
import { createBackOffice, migrateBackOfficeAudit, type BackOffice, type BackOfficeActor } from "./back-office";
import { createCoachingPlaybooksBackOffice, type CoachingPlaybooksBackOffice } from "./coaching-playbooks-back-office";

const SOURCES = "| ID | Titre | Auteur | Année | URL | Licence |\n|--|--|--|--|--|--|\n| S1 | Étude | Apec | 2026 | https://apec.fr | publique |";
const agent = { provider: "mistral" as const, model: "mistral-medium-3-5", effort: "medium" as const, consultWhen: "Quand le candidat prépare un entretien." };

describe.skipIf(!connectionString)("Coaching Playbooks' Back Office writes and their Back Office Audit (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let backOffice: BackOffice;
  let playbooks: CoachingPlaybooks;
  let changes: CoachingPlaybooksBackOffice;
  let claire: BackOfficeActor & { name: string };
  let paul: BackOfficeActor & { name: string };

  async function actor(email: string, name: string) {
    const cookie = await signInWithMagicLink(testAuth, email);
    const { user } = await (await testAuth.request("/api/auth/get-session", { cookie })).json();
    return { id: user.id, email: user.email, name };
  }

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.database;
    await migrateCoachingPlaybooks(database, () => ({
      sources: SOURCES,
      coreDigest: "# Socle [S1]",
      playbooks: [{ id: "interview-psychology", content: "# Entretiens [S1]", agent }],
      tasks: [{ id: "coach-memory", content: "Propose les faits.", agent: { ...agent, effort: null, consultWhen: "" }, validatedBy: "François Nader" }],
    }));
    await migrateBackOfficeAudit(database);
    const unused = async () => {
      throw new Error("not used here");
    };
    backOffice = createBackOffice(database, {
      billing: { setPlanQuotas: unused, resetWeeklyUsage: unused, createPlan: unused, updatePlan: unused, movePlan: unused, checkStripeProduct: unused, plans: unused, createCoupon: unused, deactivateCoupon: unused, reactivateCoupon: unused },
      humanCoaches: { add: unused, retire: unused },
    });
    playbooks = createCoachingPlaybooks(database, { serving: "latest", agentModels: () => [{ provider: "mistral", endpoint: "api.mistral.ai", residency: "eu", models: [{ model: "mistral-medium-3-5", effort: "medium_as_high", residency: "eu" }] }], evalRunOn: async () => true });
    changes = createCoachingPlaybooksBackOffice(playbooks, backOffice);
    claire = await actor("claire@jobbbox.fr", "Claire Martin");
    paul = await actor("paul@jobbbox.fr", "Paul Durand");
  }, 60_000);
  afterEach(async () => {
    await testAuth.stop();
  }, 60_000);

  const entries = async () => (await backOffice.journal()).reverse().map(({ actor: { email }, section, target, action, before, after }) => ({ email, section, target, action, before, after }));

  it("records each create, version, validation and archive, with the version it concerns; refused ones record nothing", async () => {
    expect(await changes.create(claire, { id: "salary-negotiation", content: "# Salaire [S1]", ...agent })).toMatchObject({ ok: true });
    expect(await changes.create(claire, { id: "salary-negotiation", content: "# Salaire", ...agent })).toEqual({ ok: false, error: "exists" });
    expect(await changes.save(claire, "salary-negotiation", { content: "# Salaire, v1 revue [S1]", ...agent, effort: "high" })).toMatchObject({ ok: true, newVersion: false });
    expect(await changes.save(claire, "salary-negotiation", { content: "# Salaire [S9]", ...agent })).toMatchObject({ ok: false, error: "unknown_sources" });
    expect(await changes.validate(claire, "salary-negotiation", 1)).toEqual({ ok: false, error: "own_version" });
    expect(await changes.validate(paul, "salary-negotiation", 1)).toMatchObject({ ok: true });
    expect(await changes.save(claire, "salary-negotiation", { content: "# Salaire v2 [S1]", ...agent, effort: "high" })).toMatchObject({ ok: true, newVersion: true });
    expect(await changes.setArchived(paul, "salary-negotiation", true)).toEqual({ ok: true, changed: true, version: 2 });
    expect(await changes.setArchived(paul, "salary-negotiation", true)).toEqual({ ok: true, changed: false, version: 2 });
    expect(await changes.setArchived(paul, "salary-negotiation", false)).toEqual({ ok: true, changed: true, version: 2 });

    const recorded = { provider: "mistral", model: "mistral-medium-3-5", consultWhen: agent.consultWhen };
    expect(await entries()).toEqual([
      { email: "claire@jobbbox.fr", section: "coaching_playbooks", target: "salary-negotiation", action: "added", before: null, after: { version: 1, ...recorded, effort: "medium", rulesCharacters: 14 } },
      {
        email: "claire@jobbbox.fr",
        section: "coaching_playbooks",
        target: "salary-negotiation",
        action: "updated",
        before: { version: 1, ...recorded, effort: "medium", rulesCharacters: 14 },
        after: { version: 1, ...recorded, effort: "high", rulesCharacters: 24 },
      },
      {
        email: "paul@jobbbox.fr",
        section: "coaching_playbooks",
        target: "salary-negotiation",
        action: "validated",
        before: { version: 1, validatedBy: null },
        after: { version: 1, validatedBy: "Paul Durand", validatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) },
      },
      {
        email: "claire@jobbbox.fr",
        section: "coaching_playbooks",
        target: "salary-negotiation",
        action: "updated",
        before: { version: 1, ...recorded, effort: "high", rulesCharacters: 24 },
        after: { version: 2, ...recorded, effort: "high", rulesCharacters: 17 },
      },
      { email: "paul@jobbbox.fr", section: "coaching_playbooks", target: "salary-negotiation", action: "archived", before: { version: 2, archived: false }, after: { version: 2, archived: true } },
      { email: "paul@jobbbox.fr", section: "coaching_playbooks", target: "salary-negotiation", action: "restored", before: { version: 2, archived: true }, after: { version: 2, archived: false } },
    ]);
  });

  it("records a version of the Core Digest or the Sources list without a Playbook Agent", async () => {
    await changes.save(claire, "core-digest", { content: "# Socle revu [S1]" });

    expect(await entries()).toEqual([
      { email: "claire@jobbbox.fr", section: "coaching_playbooks", target: "core-digest", action: "updated", before: { version: 1, rulesCharacters: 12 }, after: { version: 1, rulesCharacters: 17 } },
    ]);
  });

  it("records a task Playbook's versions, validation and archive like any other's (ADR-0026)", async () => {
    expect(await changes.save(claire, "coach-memory", { content: "Propose les faits clés.", provider: "mistral", model: "", effort: "" })).toMatchObject({ ok: true, newVersion: true });
    expect(await changes.validate(paul, "coach-memory", 2)).toMatchObject({ ok: true });
    expect(await changes.setArchived(paul, "coach-memory", true)).toEqual({ ok: true, changed: true, version: 2 });

    const task = { provider: "mistral", model: null, effort: null, consultWhen: "" };
    expect(await entries()).toEqual([
      {
        email: "claire@jobbbox.fr",
        section: "coaching_playbooks",
        target: "coach-memory",
        action: "updated",
        before: { version: 1, ...task, model: "mistral-medium-3-5", rulesCharacters: 18 },
        after: { version: 2, ...task, rulesCharacters: 23 },
      },
      expect.objectContaining({ email: "paul@jobbbox.fr", target: "coach-memory", action: "validated", after: expect.objectContaining({ version: 2, validatedBy: "Paul Durand" }) }),
      expect.objectContaining({ email: "paul@jobbbox.fr", target: "coach-memory", action: "archived" }),
    ]);
  });
});
