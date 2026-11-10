import { createAiLayer, readOfferFields, type UsageLog } from "@jobhub/ai";
import { createFakeProvider } from "@jobhub/ai/testing";
import type { MasterCvContent } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrateAiUsage } from "@/ai-usage";
import { webPostgresUsageLog } from "@/ai-usage/web-usage-log";
import { connectionString, startTestAuth, type TestAuth } from "@/auth/test-support";
import { isTrustedOrigin } from "@/auth/trusted-origin";
import { createExtensionEvents } from "@/extension-events";
import { createJobOffers, migrateJobOffers, type JobOffers } from "@/job-offers";
import { createMatchScoring, type MatchScoring } from "@/match-score";
import { createProfiles, migrateProfiles } from "@/profiles";

const WEB = "https://app.jobbbox.example";
const EXTENSION = "chrome-extension://jobbboxextensionid";
const TRUSTED = [WEB, EXTENSION];

/** The request being handled, as Next's request scope holds it; the app's sign-in, with no one signed in (a Guest). */
const handled = vi.hoisted(() => ({ request: null as Request | null, scoring: null as unknown, extensionEvents: null as unknown }));
vi.mock("next/headers", () => ({
  headers: async () => {
    if (!handled.request) throw new Error("outside a request");
    return handled.request.headers;
  },
}));
vi.mock("@/auth/server", () => ({
  getAuth: () => ({ options: { baseURL: `${WEB}/` } }),
  getCurrentCandidate: async () => null,
  isFromTrustedOrigin: (request: Request) => isTrustedOrigin(request.headers, TRUSTED),
}));
vi.mock("@/match-score/server", () => ({ getMatchScoring: () => handled.scoring }));
// A Match Score from the extension writes its Extension Event (#924), on the test's database.
vi.mock("@/extension-events/server", async (original) => ({ ...(await original<object>()), getExtensionEvents: () => handled.extensionEvents }));

const { POST } = await import("./route");

const cv: MasterCvContent = {
  fullName: "Marie Dupont",
  headline: "Cheffe de projet SI",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [{ title: "Cheffe de projet SI", employer: "Groupe Seb", location: "Lyon", period: "2015 – 2024", description: "IFRS, SAP." }],
  education: [],
  skills: ["IFRS", "SAP"],
  languages: [],
};

describe.skipIf(!connectionString)("POST /api/match-score records the Surface its AI call was asked from (#919; needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let jobOffers: JobOffers;
  let pending: Promise<unknown>[];

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateProfiles(database);
    await migrateJobOffers(database);
    await migrateAiUsage(database);
    jobOffers = createJobOffers(database);
    pending = [];
    const postgres = webPostgresUsageLog(database);
    const usage: UsageLog = { record: (entry) => void pending.push(Promise.resolve(postgres.record(entry))) };
    // The Match Score's phase 2 reads the offer's text: the `offer_analysis` AI call, as the app wires it.
    const ai = createAiLayer({ providers: [createFakeProvider({ id: "mistral", reply: () => "{}" })], routes: { offer_analysis: "mistral" }, usage, warn: () => {} });
    const scoring: MatchScoring = createMatchScoring({ jobOffers, profiles: createProfiles(database), readOfferText: (jobOffer, candidateId, call) => readOfferFields(ai, { candidateId, jobOffer, ...call }) });
    handled.scoring = scoring;
    handled.extensionEvents = createExtensionEvents(database);
  });
  afterEach(async () => {
    handled.request = null;
    await testAuth.stop();
  });

  /** A Job Offer with only a title and text: its Match Score reads the text with AI (phase 2), once per Job Offer. */
  async function textOnlyJobOffer(): Promise<string> {
    const captured = await jobOffers.capture({ title: "Chef de projet SI H/F", content: "Chef de projet SI. Type de contrat : CDI. Ville : Lyon. Compétences : IFRS, SAP." });
    if (!captured.ok) throw new Error("fixture Job Offer refused");
    return captured.jobOffer.id;
  }

  /** A Guest's Match Score, POSTed with `headers`; its answer and the Surface its AI call was recorded with. */
  async function matchScoreFrom(headers: Record<string, string>) {
    const jobOfferId = await textOnlyJobOffer();
    const request = new Request(`${WEB}/api/match-score`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ jobOfferId, cv, searchCriteria: { targetRole: "Chef de projet SI", locations: ["Lyon"], contractTypes: ["cdi"] } }),
    });
    handled.request = request;
    const response = await POST(request);
    handled.request = null;
    await Promise.all(pending);
    const { rows } = await database.query<{ usage: string | null; log: string | null }>(
      `SELECT u.surface AS usage, m.surface AS log FROM ai_usage u JOIN ai_message_log m ON m.usage_id = u.id ORDER BY u.at DESC LIMIT 1`,
    );
    const body: unknown = await response.json();
    return { status: response.status, body, recorded: rows[0] ?? null };
  }

  it("from the extension (an extension's Origin): `extension`", async () => {
    const { status, recorded } = await matchScoreFrom({ origin: EXTENSION });

    expect(status).toBe(200);
    expect(recorded).toEqual({ usage: "extension", log: "extension" });
  });

  it("from the web app: `web`", async () => {
    const { status, recorded } = await matchScoreFrom({ origin: WEB });

    expect(status).toBe(200);
    expect(recorded).toEqual({ usage: "web", log: "web" });
  });

  it("answers the same whatever the Surface: only what is recorded changes", async () => {
    const fromWeb = await matchScoreFrom({ origin: WEB });
    const fromExtension = await matchScoreFrom({ origin: EXTENSION });

    expect(fromExtension.status).toBe(fromWeb.status);
    expect(fromExtension.body).toEqual(fromWeb.body);
  });

  it("refuses another site as before, and records no AI call for it", async () => {
    const { status, recorded } = await matchScoreFrom({ origin: "https://evil.example" });

    expect(status).toBe(403);
    expect(recorded).toBeNull();
  });
});
