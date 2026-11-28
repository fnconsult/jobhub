import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "@/auth/test-support";
import { isTrustedOrigin } from "@/auth/trusted-origin";
import { createLinkedInReadings, migrateLinkedInReadings } from "@/linkedin-readings";
import { migrateApplications } from "@/applications";
import { migrateJobOffers } from "@/job-offers";
import { migrateProfiles } from "@/profiles";
import { migrateTargetCompanies } from "@/target-companies";

const WEB = "https://app.jobbbox.example";
const EXTENSION = "chrome-extension://jobbboxextensionid";

const handled = vi.hoisted(() => ({ candidate: null as { id: string } | null, readings: null as unknown, on: true }));
vi.mock("@/auth/server", () => ({
  getAuth: () => ({ options: { baseURL: `${WEB}/` } }),
  getCurrentCandidate: async () => handled.candidate,
  isFromTrustedOrigin: (request: Request) => isTrustedOrigin(request.headers, [WEB, EXTENSION]),
}));
vi.mock("@/linkedin-readings/server", () => ({ getLinkedInReadings: () => handled.readings }));
vi.mock("@/coach-actions/on", () => ({ linkedInReadingOn: () => handled.on }));

const { GET, POST } = await import("./route");

const reading = {
  page: { kind: "people", url: "https://www.linkedin.com/company/exemple-industrie-fictive/people/" },
  company: "Exemple Industrie Fictive",
  department: "Achats",
  people: [{ name: "Camille Fictive", role: "Responsable achats" }],
};

describe.skipIf(!connectionString)("/api/linkedin-readings: what the extension read on LinkedIn, on the Candidate's click (#1164; needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.database;
    await migrateProfiles(database);
    await migrateJobOffers(database);
    await migrateApplications(database);
    await migrateTargetCompanies(database);
    await migrateLinkedInReadings(database);
    handled.readings = createLinkedInReadings(database);
    handled.on = true;
    const cookie = await signInWithMagicLink(testAuth, "nathalie.exemple@example.fr");
    handled.candidate = { id: (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id };
  }, 60_000);
  afterEach(async () => {
    await testAuth.stop();
  }, 60_000);

  const send = (body: unknown, headers: Record<string, string> = { origin: EXTENSION }) =>
    POST(new Request(`${WEB}/api/linkedin-readings`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
  const readingsKept = async () => (await database.query(`SELECT count(*)::int AS n FROM linkedin_reading`)).rows[0].n;

  it("keeps a signed-in Candidate's Reading from the extension, and says where its people went: 201", async () => {
    const response = await send(reading);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ company: "Exemple Industrie Fictive", peopleRead: 1, peopleKept: 0, filedIn: [] });
    expect(await readingsKept()).toBe(1);
  });

  it("tells the extension whether it may read LinkedIn: on for a signed-in Candidate while LINKEDIN_READING_ENABLED is on", async () => {
    expect(await (await GET()).json()).toEqual({ enabled: true });
    handled.on = false;
    expect(await (await GET()).json()).toEqual({ enabled: false });
    handled.candidate = null;
    expect((await GET()).status).toBe(401);
  });

  it("keeps nothing while LINKEDIN_READING_ENABLED is off (and in Production until #1160): 404", async () => {
    handled.on = false;
    expect((await send(reading)).status).toBe(404);
    expect(await readingsKept()).toBe(0);
  });

  it("refuses a Guest, a call that is not the extension's, and what is not a Reading", async () => {
    expect((await send(reading, { origin: WEB })).status).toBe(403);
    expect((await send(reading, { origin: "https://www.linkedin.com" })).status).toBe(403);
    expect((await send({ ...reading, page: { kind: "people", url: "https://www.linkedin.com/in/camille-fictive/" } })).status).toBe(400);
    handled.candidate = null;
    expect((await send(reading)).status).toBe(401);
    expect(await readingsKept()).toBe(0);
  });
});
