import { getMigrations } from "better-auth/db/migration";
import { organization } from "better-auth/plugins/organization";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, startTestAuth, type TestAuth } from "./test-support";

// ADR-0004 / ADR-0011: Organisations will sit above Candidates without migrating data.
describe.skipIf(!connectionString)("Organisation readiness (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  beforeEach(async () => {
    testAuth = await startTestAuth();
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  it("adds an Organisation layer above Candidates with new tables only, leaving Candidate data untouched", async () => {
    const current = testAuth.auth.options;

    const plan = await getMigrations(
      { ...current, plugins: [...current.plugins, organization()] },
      { throwOnUnsafe: false },
    );

    expect(plan.toBeCreated.map((table) => table.table).sort()).toEqual(["invitation", "member", "organization"]);
    expect(plan.toBeCreated.find((table) => table.table === "member")?.fields.userId?.references?.model).toBe(
      "candidate",
    );
    expect(plan.toBeAdded.map((table) => table.table)).not.toContain("candidate");
    expect(plan.unsafeChanges).toEqual([]);
  });
});
