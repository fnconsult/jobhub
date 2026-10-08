import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createHumanCoaches, migrateHumanCoaches, type HumanCoaches } from "./index";

const SOPHIE = { name: "Sophie Martin", email: "sophie.martin@rh-conseil.fr", bookingUrl: "https://cal.com/sophie-martin/seance" };

describe.skipIf(!connectionString)("Human Coaches (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let coaches: HumanCoaches;

  async function signUp(email: string) {
    const cookie = await signInWithMagicLink(testAuth, email);
    return (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id as string;
  }

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateHumanCoaches(database);
    coaches = createHumanCoaches(database);
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  describe("in the Back Office", () => {
    it("adds a Human Coach with their Cal.com booking link", async () => {
      const added = await coaches.add({ ...SOPHIE, bio: "  Ancienne DRH, 20 ans dans l'industrie. " });

      expect(added).toMatchObject({ ok: true, coach: { ...SOPHIE, bio: "Ancienne DRH, 20 ans dans l'industrie." } });
      expect(await coaches.list()).toEqual([added.ok && added.coach]);
    });

    it("refuses a booking link that is not a Cal.com page", async () => {
      for (const bookingUrl of ["https://calendly.com/sophie", "http://cal.com/sophie", "cal.com/sophie", "https://cal.com/", "https://evil.com/cal.com/x"]) {
        expect(await coaches.add({ ...SOPHIE, bookingUrl })).toEqual({ ok: false, errors: [{ field: "bookingUrl", code: "invalid" }] });
      }
      expect((await coaches.add({ ...SOPHIE, bookingUrl: "https://app.cal.eu/sophie/30min" })).ok).toBe(true);
    });

    it("requires a name and a valid email, and one Human Coach per email", async () => {
      expect(await coaches.add({ ...SOPHIE, name: " ", email: "sophie" })).toEqual({
        ok: false,
        errors: [
          { field: "name", code: "required" },
          { field: "email", code: "invalid" },
        ],
      });
      await coaches.add(SOPHIE);
      expect(await coaches.add({ ...SOPHIE, email: "Sophie.Martin@RH-conseil.fr" })).toEqual({ ok: false, error: "email_taken" });
    });

    it("retires a Human Coach: no longer listed", async () => {
      const added = await coaches.add(SOPHIE);
      if (!added.ok) throw new Error("fixture refused");

      await coaches.retire(added.coach.id);

      expect(await coaches.list()).toEqual([]);
    });
  });
});
