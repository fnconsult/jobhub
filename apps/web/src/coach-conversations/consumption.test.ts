/**
 * A Coach reply counts once in Consumption (#799), whatever its Tool rounds: AI Usage writes a row per round, the
 * reply is one `coach_message` with author `coach`, and that insert is where it counts. Driven end to end: the AI
 * Coach on the fake provider, its scripted tool calls, and the conversation saved in Postgres.
 */
import { createAiLayer } from "@jobhub/ai";
import { createFakeProvider, createMemoryUsageLog } from "@jobhub/ai/testing";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as z from "zod";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createCoach } from "../coach";
import { createCoachActions, defineCoachAction } from "../coach-actions";
import { createConsumption } from "../consumption";
import { migrateApplications } from "../applications";
import { migrateJobDigests } from "../job-digests";
import { migrateJobOffers } from "../job-offers";
import { migrateJobSearches } from "../job-searches";
import { createProfiles, migrateProfiles } from "../profiles";
import { createCoachConversations, migrateCoachConversations } from "./index";

const REPLY = "Votre candidature au poste de DAF est au stade de l'entretien.";

const READ = defineCoachAction({
  name: "lire_candidature",
  description: "Lit une candidature du candidat par son id.",
  schema: z.object({ id: z.string() }),
  group: "applications",
  kind: "read",
  copiesText: false,
  async run({ id }) {
    return { ok: true, data: { id, status: "interview" }, pages: [`/candidatures/${id}`], untrusted: true };
  },
});

describe.skipIf(!connectionString)("a Coach reply in Consumption (#799, needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let marie: string;

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateProfiles(database);
    await migrateJobOffers(database);
    await migrateApplications(database);
    await migrateJobSearches(database);
    await migrateJobDigests(database);
    await migrateCoachConversations(database);
    const cookie = await signInWithMagicLink(testAuth, "marie.dupont@example.fr");
    marie = (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id;
  }, 60_000);
  afterEach(async () => {
    await testAuth.stop();
  }, 60_000);

  it("one Coach reply with 3 tool rounds adds exactly 1 to coach for that day", async () => {
    const call = (id: string) => ({ toolCalls: [{ name: "lire_candidature", arguments: { id } }] });
    const provider = createFakeProvider({
      id: "mistral",
      reply: (input) => (input.system?.startsWith("Tu choisis quels Playbook Agents") ? "[]" : REPLY),
      turns: [call("a1"), call("a2"), call("a3"), { text: REPLY }],
    });
    const usage = createMemoryUsageLog();
    const ai = createAiLayer({ providers: [provider], routes: { coaching: "mistral" }, usage });
    const coach = createCoach({
      ai,
      playbooks: { served: async () => ({ coreDigest: null, sources: null, playbooks: [] }) },
      context: async () => "Le candidat s'appelle Marie (prénom seulement).",
      coachActions: createCoachActions({ catalog: [READ], settings: async () => ({ enabled: true, maxRounds: 3 }), externalApis: { record: () => {} } }),
      warn: () => {},
    });
    const now = new Date("2026-11-05T10:00:00Z");
    const conversations = createCoachConversations(database, { coach, profiles: createProfiles(database), now: () => now });
    const consumption = createConsumption(database);
    const counted = async () => (await consumption.forCandidate(marie, { from: now, to: now })).totals.coach;

    const sent = await conversations.send(marie, { message: "Où en sont mes candidatures a1, a2 et a3 ?" });

    expect(sent).toMatchObject({ ok: true, reply: REPLY });
    // Four coaching turns, three of them Tool rounds: AI Usage has a line for each.
    expect(usage.entries.filter((entry) => entry.task === "coaching")).toHaveLength(4);
    expect(await counted()).toBe(1);
    expect((await consumption.forCandidate(marie, { from: now, to: now })).days).toEqual([{ day: "2026-11-05", tool: "coach", count: 1 }]);
  });
});
