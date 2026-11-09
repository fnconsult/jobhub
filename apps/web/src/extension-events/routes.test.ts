import { EXTENSION_VERSION_HEADER, type MasterCvContent } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApplications } from "@/applications";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "@/auth/test-support";
import { isTrustedOrigin } from "@/auth/trusted-origin";
import { createJobOffers, migrateJobOffers, type JobOffers } from "@/job-offers";
import { createMatchScoring } from "@/match-score";
import { createProfiles, migrateProfiles, type Profiles } from "@/profiles";
import { migrateApplications } from "@/applications";
import { createExtensionEvents, migrateExtensionEvents } from "./index";

/**
 * The five actions the extension does through the web app (#924): each, from the extension, writes exactly one
 * Extension Event, for a Guest and a Candidate alike; the same action from the web app writes none.
 */

const WEB = "https://app.jobbbox.example";
const EXTENSION = "chrome-extension://jobbboxextensionid";

const handled = vi.hoisted(() => ({ candidate: null as { id: string; interfaceLanguage: string } | null, modules: {} as Record<string, unknown> }));
vi.mock("next/headers", () => ({
  headers: async () => {
    throw new Error("outside a request");
  },
}));
vi.mock("@/auth/server", () => ({
  getAuth: () => ({ options: { baseURL: `${WEB}/` } }),
  getCurrentCandidate: async () => handled.candidate,
  isFromTrustedOrigin: (request: Request) => isTrustedOrigin(request.headers, [WEB, EXTENSION]),
}));
vi.mock("@/job-offers/server", () => ({ getJobOffers: () => handled.modules.jobOffers }));
vi.mock("@/match-score/server", () => ({ getMatchScoring: () => handled.modules.matchScoring }));
vi.mock("@/profiles/server", () => ({ getProfiles: () => handled.modules.profiles, profileUpgradePromptFor: async () => null }));
vi.mock("@/applications/server", () => ({ getApplications: () => handled.modules.applications }));
vi.mock("@/extension-events/server", async (original) => ({ ...(await original<object>()), getExtensionEvents: () => handled.modules.extensionEvents }));
vi.mock("@/ai/server", () => ({ getAi: () => ({}) }));
vi.mock("@/task-playbooks/server", () => ({ getTaskPlaybooks: () => ({}) }));
// The CV draft reads a file; what it reads is the CV module's own tests'. Here: a draft, as a Guest's or a Candidate's.
vi.mock("@/cv", async (original) => ({
  ...(await original<object>()),
  draftFromCv: async () => ({ masterCv: cv, searchCriteria: { targetRole: "Cheffe de projet SI", locations: ["Lyon"] } }),
}));

const captureRoute = await import("@/app/api/job-offers/route");
const matchScoreRoute = await import("@/app/api/match-score/route");
const cvDraftRoute = await import("@/app/api/cv/draft/route");
const profilesRoute = await import("@/app/api/profiles/route");
const applicationsRoute = await import("@/app/api/applications/route");

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
const searchCriteria = { targetRole: "Cheffe de projet SI", locations: ["Lyon"], contractTypes: ["cdi"] };

type Surface = "extension" | "web";
const FROM: Record<Surface, Record<string, string>> = {
  extension: { origin: EXTENSION, [EXTENSION_VERSION_HEADER]: "0.2.0" },
  web: { origin: WEB },
};

describe.skipIf(!connectionString)("each action from the extension writes one Extension Event, from the web none (#924; needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let jobOffers: JobOffers;
  let profiles: Profiles;
  let marie: { id: string; interfaceLanguage: string };

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.database;
    await migrateProfiles(database);
    await migrateJobOffers(database);
    await migrateApplications(database);
    await migrateExtensionEvents(database);
    jobOffers = createJobOffers(database);
    profiles = createProfiles(database);
    handled.modules = {
      jobOffers,
      profiles,
      matchScoring: createMatchScoring({ jobOffers, profiles }),
      applications: createApplications(database, { jobOffers, profiles, sentByShareCapture: async () => false }),
      extensionEvents: createExtensionEvents(database),
    };
    const cookie = await signInWithMagicLink(testAuth, "marie.dupont@example.fr");
    marie = { id: (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id, interfaceLanguage: "fr" };
    handled.candidate = null;
  }, 60_000);
  afterEach(async () => {
    await testAuth.stop();
  }, 60_000);

  const json = (path: string, surface: Surface, body: unknown) =>
    new Request(`${WEB}${path}`, { method: "POST", headers: { "content-type": "application/json", ...FROM[surface] }, body: JSON.stringify(body) });

  async function events() {
    const { rows } = await database.query<{ kind: string; candidate_id: string | null; extension_version: string | null; object_type: string | null; object_id: string | null }>(
      `SELECT kind, candidate_id, extension_version, object_type, object_id FROM extension_event ORDER BY id`,
    );
    return rows;
  }

  async function capturedJobOffer(): Promise<string> {
    const captured = await jobOffers.capture({ title: "Chef de projet SI H/F", content: "Chef de projet SI. CDI à Lyon. IFRS, SAP.", location: "Lyon", contractType: "cdi", skills: ["IFRS", "SAP"] });
    if (!captured.ok) throw new Error("fixture Job Offer refused");
    return captured.jobOffer.id;
  }

  async function profileOfMarie(): Promise<string> {
    const created = await profiles.create(marie.id, { masterCv: cv, searchCriteria });
    if (!created.ok) throw new Error("fixture Profile refused");
    return created.profile.id;
  }

  const actions = {
    capture: async (surface: Surface) => {
      const response = await captureRoute.POST(json("/api/job-offers", surface, { source: { url: "https://www.welcometothejungle.com/fr/jobs/1" }, title: "Chef de projet SI H/F", content: "Chef de projet SI. CDI à Lyon." }));
      return { status: response.status, object: { type: "job_offer", id: ((await response.json()) as { id: string }).id } };
    },
    match_score: async (surface: Surface) => {
      const jobOfferId = await capturedJobOffer();
      const response = await matchScoreRoute.POST(json("/api/match-score", surface, { jobOfferId, cv, searchCriteria }));
      return { status: response.status, object: { type: "job_offer", id: jobOfferId } };
    },
    cv_draft: async (surface: Surface) => {
      const form = new FormData();
      form.append("cv", new File([new Uint8Array([37, 80, 68, 70])], "cv.pdf", { type: "application/pdf" }));
      const response = await cvDraftRoute.POST(new Request(`${WEB}/api/cv/draft`, { method: "POST", headers: FROM[surface], body: form }));
      return { status: response.status, object: null };
    },
    profile_created: async (surface: Surface) => {
      const response = await profilesRoute.POST(json("/api/profiles", surface, { masterCv: cv, searchCriteria }));
      return { status: response.status, object: { type: "profile", id: ((await response.json()) as { id: string }).id } };
    },
    application_created: async (surface: Surface) => {
      const [jobOfferId, profileId] = [await capturedJobOffer(), await profileOfMarie()];
      const response = await applicationsRoute.POST(json("/api/applications", surface, { jobOfferId, profileId }));
      return { status: response.status, object: { type: "application", id: ((await response.json()) as { id: string }).id } };
    },
  };
  const guestActions = ["capture", "match_score", "cv_draft"] as const;
  const candidateActions = Object.keys(actions) as (keyof typeof actions)[];

  it.each(guestActions)("%s by a Guest from the extension: one row, naming no one", async (kind) => {
    const done = await actions[kind]("extension");

    expect(done.status).toBeLessThan(300);
    expect(await events()).toEqual([{ kind, candidate_id: null, extension_version: "0.2.0", object_type: done.object?.type ?? null, object_id: done.object?.id ?? null }]);
  });

  it.each(candidateActions)("%s by a Candidate from the extension: one row, theirs", async (kind) => {
    handled.candidate = marie;

    const done = await actions[kind]("extension");

    expect(done.status).toBeLessThan(300);
    expect(await events()).toEqual([{ kind, candidate_id: marie.id, extension_version: "0.2.0", object_type: done.object?.type ?? null, object_id: done.object?.id ?? null }]);
  });

  it.each(candidateActions)("%s from the web app: no row", async (kind) => {
    handled.candidate = marie;

    const done = await actions[kind]("web");

    expect(done.status).toBeLessThan(300);
    expect(await events()).toEqual([]);
  });

  it("an Application saved again from the extension, already theirs, writes no second row", async () => {
    handled.candidate = marie;
    const [jobOfferId, profileId] = [await capturedJobOffer(), await profileOfMarie()];

    const first = await applicationsRoute.POST(json("/api/applications", "extension", { jobOfferId, profileId }));
    const again = await applicationsRoute.POST(json("/api/applications", "extension", { jobOfferId, profileId }));

    expect([first.status, again.status]).toEqual([201, 200]);
    expect((await events()).map((event) => event.kind)).toEqual(["application_created"]);
  });

  it("an action refused writes no row", async () => {
    const response = await captureRoute.POST(json("/api/job-offers", "extension", { title: "" }));

    expect(response.status).toBe(400);
    expect(await events()).toEqual([]);
  });
});
