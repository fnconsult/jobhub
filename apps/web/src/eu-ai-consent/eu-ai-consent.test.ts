import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createEuAiConsents, migrateEuAiConsents, type EuAiConsents } from "./index";

describe.skipIf(!connectionString)("EU AI consent (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let marie: string;
  let jean: string;
  let now: Date;
  let consents: EuAiConsents;

  async function candidate(email: string): Promise<string> {
    const cookie = await signInWithMagicLink(testAuth, email);
    return (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id;
  }

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateEuAiConsents(database);
    await migrateEuAiConsents(database); // safe to run twice
    marie = await candidate("marie.dupont@example.fr");
    jean = await candidate("jean.martin@example.fr");
    now = new Date("2026-10-12T09:30:00Z");
    consents = createEuAiConsents(database, { now: () => now });
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  it("is not given until the Candidate gives it, then is recorded with its date for that Candidate only", async () => {
    expect(await consents.givenAt(marie)).toBeNull();
    expect(await consents.has(marie)).toBe(false);

    await consents.give(marie);

    expect(await consents.givenAt(marie)).toEqual(new Date("2026-10-12T09:30:00Z"));
    expect(await consents.has(marie)).toBe(true);
    expect(await consents.has(jean)).toBe(false);
  });

  it("keeps the date it was first given when given again", async () => {
    await consents.give(marie);
    now = new Date("2026-11-01T10:00:00Z");

    expect(await consents.give(marie)).toEqual(new Date("2026-10-12T09:30:00Z"));
    expect(await consents.givenAt(marie)).toEqual(new Date("2026-10-12T09:30:00Z"));
  });

  it("can be withdrawn, and given again later with the new date", async () => {
    await consents.give(marie);
    await consents.withdraw(marie);

    expect(await consents.has(marie)).toBe(false);

    now = new Date("2026-11-01T10:00:00Z");
    await consents.give(marie);
    expect(await consents.givenAt(marie)).toEqual(new Date("2026-11-01T10:00:00Z"));
  });
});
