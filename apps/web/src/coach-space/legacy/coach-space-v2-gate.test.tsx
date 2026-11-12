import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

// « Espace coach v2 » (ADR-0106) on the Coach space: off, a Human Coach gets main's /espace-coach (its sessions, its Coach
// Access list, the Candidate's file, main's header) and nothing the Human Coach epic added answers; on, the new workspace.
const state = vi.hoisted(() => ({ on: false }));
vi.mock("@/coach-space-v2/server", () => ({
  coachSpaceV2On: () => state.on,
  requireCoachSpaceV2: () => {
    if (!state.on) throw new Error("404");
  },
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("404");
  },
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
vi.mock("@/coach-space/server", () => ({ requireCoachSpace: async () => ({ id: "coach" }) }));
vi.mock("@/coach-space/CoachSpaceLayout", () => ({ CoachSpaceLayout: () => null }));
vi.mock("@/coaching-notifications/activation-server", () => ({ coachingNoticesOn: () => false }));
vi.mock("@/coach-space/legacy/LegacyCoachSpaceShell", () => ({ LegacyCoachSpaceShell: () => null, LegacyCoachSpaceHeader: () => null }));
vi.mock("@/coach-space/legacy/LegacyCoachSpacePage", () => ({
  LegacyCoachSpacePage: () => null,
  legacyCoachSpaceMetadata: async () => ({ title: "Espace coach · Jobbbox" }),
}));
vi.mock("@/coach-space/legacy/LegacyCoachedCandidatePage", () => ({
  LegacyCoachedCandidatePage: () => null,
  legacyCoachedCandidateMetadata: async () => ({ title: "Marie Dupont · Espace coach" }),
  legacyCandidateUrl: (id: string) => `/espace-coach/${encodeURIComponent(id)}`,
}));
vi.mock("@/coach-space/workspace-server", () => ({ getCoachWorkspace: () => ({ candidate: async () => null }) }));
vi.mock("@/coaching-time/server", () => ({ getCoachingTimeZones: () => ({}) }));
vi.mock("@/i18n/server", () => ({ getServerT: async () => (key: string) => key, getRequestLocale: async () => "fr" }));
vi.mock("@/coach-space/PrivateNotes", () => ({ PrivateNotes: () => null }));
vi.mock("@/coach-space/SessionCard", () => ({ SessionCard: () => null }));
vi.mock("@/components/MasterCvView", () => ({ MasterCvView: () => null }));
vi.mock("@/auth/server", () => ({ getCurrentCandidate: async () => ({ id: "person", email: "claire@example.com", emailVerified: true }) }));
vi.mock("@/human-coaches/server", () => ({
  getHumanCoaches: () => ({ coachSignedIn: async () => ({ id: "coach" }) }),
  hasHumanCoachIdentity: async () => true,
}));
vi.mock("@/coach-associations/server", () => ({ hasAssociationIdentity: async () => true }));

import { GET as coachSpaceRead } from "@/app/api/coach-space/route";
import CandidateFilePage from "@/app/espace-coach/candidates/[candidateId]/page";
import CoachedCandidatePage, { generateMetadata as coachedCandidateMetadata } from "@/app/espace-coach/[candidateId]/page";
import CoachSpacePage, { generateMetadata as coachSpaceMetadata } from "@/app/espace-coach/page";
import { LegacyCoachedCandidatePage } from "@/coach-space/legacy/LegacyCoachedCandidatePage";
import { LegacyCoachSpacePage } from "@/coach-space/legacy/LegacyCoachSpacePage";
import { LegacyCoachSpaceShell } from "@/coach-space/legacy/LegacyCoachSpaceShell";
import { CoachSpaceLayout } from "@/coach-space/CoachSpaceLayout";
import { CoachSpaceShell } from "@/components/CoachSpaceHeader";

const params = Promise.resolve({ candidateId: "candidate-1" });

describe("« Espace coach v2 » off: main's Coach space", () => {
  beforeEach(() => {
    state.on = false;
  });
  it("draws main's header and footer around a Coach space page", () => {
    expect(CoachSpaceShell({ children: "page" }).type).toBe(LegacyCoachSpaceShell);
  });
  it("serves main's sessions and Coach Access list at /espace-coach, under main's title", async () => {
    expect(((await CoachSpacePage()) as { type: unknown }).type).toBe(LegacyCoachSpacePage);
    expect(await coachSpaceMetadata()).toEqual({ title: "Espace coach · Jobbbox" });
  });
  it("serves main's Candidate file at /espace-coach/{candidateId}", async () => {
    const page = (await CoachedCandidatePage({ params })) as { type: unknown; props: { params: unknown } };
    expect(page.type).toBe(LegacyCoachedCandidatePage);
    expect(page.props.params).toBe(params);
    expect(await coachedCandidateMetadata({ params })).toEqual({ title: "Marie Dupont · Espace coach" });
  });
  it("sends the new Candidate file's address (a Coach Access push) to main's", async () => {
    await expect(CandidateFilePage({ params })).rejects.toThrow("redirect /espace-coach/candidate-1");
  });
  it("tells the app an active Human Coach has « Espace coach », and nothing of an Association", async () => {
    expect(await (await coachSpaceRead()).json()).toEqual({ humanCoach: true });
  });
});

describe("« Espace coach v2 » on: the new workspace", () => {
  beforeEach(() => {
    state.on = true;
  });
  it("draws the workspace's sidebar layout", () => {
    expect(CoachSpaceShell({ children: "page" }).type).toBe(CoachSpaceLayout);
  });
  it("opens /espace-coach on « Aujourd'hui »", async () => {
    await expect(CoachSpacePage()).rejects.toThrow("redirect /espace-coach/aujourdhui");
    expect(await coachSpaceMetadata()).toEqual({});
  });
  it("sends /espace-coach/{candidateId} to the workspace's Candidate file", async () => {
    await expect(CoachedCandidatePage({ params })).rejects.toThrow("redirect /espace-coach/candidates/candidate-1");
  });
  it("reads the new Candidate file", async () => {
    await expect(CandidateFilePage({ params })).rejects.toThrow("404");
  });
  it("tells the app of the Association space too", async () => {
    expect(await (await coachSpaceRead()).json()).toEqual({ humanCoach: true, associationSpace: true, coachSpaceV2: true });
  });
});

// Every page and route this area added (not on main) refuses to answer while the setting is off: it calls
// requireCoachSpaceV2, or requireCoachSpace, which does. The files main had are dispatched above.
const app = fileURLToPath(new URL("../../app/", import.meta.url));
const MAIN_FILES = new Set([
  "espace-coach/page.tsx",
  "espace-coach/[candidateId]/page.tsx",
  "espace-coach/[candidateId]/candidatures/[applicationId]/page.tsx",
  "espace-coach/[...missing]/page.tsx",
  "espace-coach/not-found.tsx",
  "espace-coach/sortie/page.tsx",
  "api/coach-space/route.ts",
  "api/coach-space/sessions/[sessionId]/route.ts",
  "api/coach-space/sessions/[sessionId]/cancel/route.ts",
]);
/** The request's own redirect to the old Candidate file stands in for the 404 on this one (see its page). */
const REDIRECTED_WHEN_OFF = new Set(["espace-coach/candidates/[candidateId]/page.tsx"]);

function files(path: string): string[] {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path).flatMap((entry) => files(join(path, entry)));
}

const GATED = ["espace-coach", "espace-association", "devenir-coach", "api/coach-space", "api/coach-enrolments"]
  .flatMap((directory) => files(join(app, directory)))
  .filter((file) => /(page|layout|route)\.tsx?$/.test(file) && !/\.test\./.test(file))
  .map((file) => relative(app, file).split(sep).join("/"))
  .filter((file) => !MAIN_FILES.has(file));

describe("what the Human Coach epic added to the Coach space answers 404 while « Espace coach v2 » is off", () => {
  it("finds the new pages and routes", () => {
    expect(GATED.length).toBeGreaterThan(25);
  });
  it.each(GATED)("%s", (file) => {
    const source = readFileSync(join(app, file), "utf8");
    if (REDIRECTED_WHEN_OFF.has(file)) expect(source).toMatch(/if \(!coachSpaceV2On\(\)\) redirect\(/);
    else expect(source).toMatch(/requireCoachSpaceV2\(\)|requireCoachSpace\(\)|CoachSpaceEmptyPage\(/);
  });
});
