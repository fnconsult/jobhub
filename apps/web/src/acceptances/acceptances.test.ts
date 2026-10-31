import type { LegalTextVersionRecord } from "@jobhub/help";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { CGU_RETENTION_YEARS, CGV_RETENTION_YEARS, createAcceptances, migrateAcceptances, purgeExpiredAcceptances, type AcceptancesOptions } from "./index";

const SECRET = "test-secret-test-secret-test-secret-0123";

/** A CGU or CGV version as the registry of #546 records it. */
function version(text: "cgu" | "cgv", id: string, change: "substantielle" | "mineure" = "substantielle"): LegalTextVersionRecord {
  return { text, version: id, url: `/legal/${text}/${id}`, sha256: `${text}-${id}`.padEnd(64, "0"), change };
}

describe.skipIf(!connectionString)("Acceptances of the CGU and CGV (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let marie: string;
  let jean: string;
  let now: Date;
  let registry: LegalTextVersionRecord[];

  async function candidate(email: string): Promise<string> {
    const cookie = await signInWithMagicLink(testAuth, email);
    return (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id;
  }

  const acceptances = (options: Partial<AcceptancesOptions> = {}) => createAcceptances(database, { registry: () => registry, secret: SECRET, now: () => now, ...options });

  async function rows() {
    return (
      await database.query<Record<string, unknown>>(
        `SELECT candidate_id, holder, text, version, url, sha256, channel, checkout_session_id, immediate_execution_requested, accepted_at, account_deleted_at
           FROM legal_acceptance ORDER BY id`,
      )
    ).rows;
  }

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateAcceptances(database);
    await migrateAcceptances(database); // safe to run twice
    marie = await candidate("marie.dupont@example.fr");
    jean = await candidate("jean.martin@example.fr");
    now = new Date("2026-12-01T09:30:00Z");
    registry = [];
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  describe("with no CGU version in the registry", () => {
    it("asks nothing: the Candidate goes on as before, and nothing can be accepted", async () => {
      expect(await acceptances().pending(marie)).toBeNull();
      expect(await acceptances().accept(marie, "2026-12-01")).toBe("stale");
      expect(await rows()).toEqual([]);
    });

    it("asks nothing for a CGU version that is not in effect yet, nor for the CGV alone", async () => {
      registry = [version("cgu", "2026-12-15"), version("cgv", "2026-11-01")];

      expect(await acceptances().pending(marie)).toBeNull();
    });
  });

  describe("with a CGU version in effect", () => {
    beforeEach(() => {
      registry = [version("cgu", "2026-12-01", "mineure")];
    });

    it("asks every Candidate for it, the first version counting as substantial", async () => {
      expect(await acceptances().pending(marie)).toEqual(version("cgu", "2026-12-01", "mineure"));
      expect(await acceptances().pending(jean)).toEqual(version("cgu", "2026-12-01", "mineure"));
    });

    it("writes one Acceptance row: the version, its URL and fingerprint, the date, and « premiere_connexion »", async () => {
      expect(await acceptances().accept(marie, "2026-12-01")).toBe("accepted");

      expect(await rows()).toEqual([
        {
          candidate_id: marie,
          holder: expect.stringMatching(/^[0-9a-f]{64}$/),
          text: "cgu",
          version: "2026-12-01",
          url: "/legal/cgu/2026-12-01",
          sha256: version("cgu", "2026-12-01").sha256,
          channel: "premiere_connexion",
          checkout_session_id: null,
          immediate_execution_requested: null,
          accepted_at: now,
          account_deleted_at: null,
        },
      ]);
      expect(await acceptances().pending(marie)).toBeNull();
      expect(await acceptances().pending(jean)).not.toBeNull();
    });

    it("is asked once: accepting again writes nothing more", async () => {
      await acceptances().accept(marie, "2026-12-01");

      expect(await acceptances().accept(marie, "2026-12-01")).toBe("accepted");
      expect(await rows()).toHaveLength(1);
    });

    it("refuses a version other than the one to accept now", async () => {
      expect(await acceptances().accept(marie, "2026-11-01")).toBe("stale");
      expect(await acceptances().accept(marie, "2026-12-15")).toBe("stale");
      expect(await rows()).toEqual([]);
    });

    it("keeps a pseudonym of the Candidate that is not their email nor its plain hash, and needs the secret", async () => {
      await acceptances().accept(marie, "2026-12-01");
      await acceptances().accept(jean, "2026-12-01");
      const [hers, his] = (await rows()).map((row) => row.holder as string);

      expect(hers).not.toEqual(his);
      expect(hers).not.toContain("marie");
      expect(acceptances().holderOf("Marie.Dupont@example.fr ")).toEqual(hers);
      expect(acceptances({ secret: "another-secret-another-secret-012345" }).holderOf("marie.dupont@example.fr")).not.toEqual(hers);
      const { createHash } = await import("node:crypto");
      expect(hers).not.toEqual(createHash("sha256").update("marie.dupont@example.fr").digest("hex"));
    });
  });

  describe("when a new CGU version takes effect", () => {
    beforeEach(async () => {
      registry = [version("cgu", "2026-12-01")];
      await acceptances().accept(marie, "2026-12-01");
    });

    it("asks again, at the next sign-in, once a substantial version is in effect; « nouvelle_acceptation »", async () => {
      registry.push(version("cgu", "2027-02-01", "substantielle"));
      expect(await acceptances().pending(marie)).toBeNull();

      now = new Date("2027-02-01T08:00:00Z");
      expect(await acceptances().pending(marie)).toEqual(version("cgu", "2027-02-01"));

      expect(await acceptances().accept(marie, "2027-02-01")).toBe("accepted");
      expect((await rows()).map((row) => [row.version, row.channel])).toEqual([
        ["2026-12-01", "premiere_connexion"],
        ["2027-02-01", "nouvelle_acceptation"],
      ]);
      expect(await acceptances().pending(marie)).toBeNull();
    });

    it("asks nothing for a minor version, but a Candidate who never accepted is asked the version in effect", async () => {
      registry.push(version("cgu", "2027-02-01", "mineure"));
      now = new Date("2027-02-01T08:00:00Z");

      expect(await acceptances().pending(marie)).toBeNull();
      expect(await acceptances().pending(jean)).toEqual(version("cgu", "2027-02-01", "mineure"));
    });

    it("after a substantial then a minor version, asks the version in effect, the minor one", async () => {
      registry.push(version("cgu", "2027-02-01", "substantielle"), version("cgu", "2027-03-01", "mineure"));
      now = new Date("2027-03-02T08:00:00Z");

      expect(await acceptances().pending(marie)).toEqual(version("cgu", "2027-03-01", "mineure"));
      expect(await acceptances().accept(marie, "2027-02-01")).toBe("stale");
    });
  });

  it("records a CGV Acceptance at a payment, with its Checkout session and the request for immediate performance (#512)", async () => {
    registry = [version("cgv", "2026-11-01")];

    await acceptances().acceptAtCheckout(marie, { channel: "paiement_plan", checkoutSessionId: "cs_test_1", immediateExecutionRequested: true });
    await acceptances().acceptAtCheckout(marie, { channel: "paiement_coaching", checkoutSessionId: "cs_test_2", immediateExecutionRequested: false });

    expect((await rows()).map((row) => [row.text, row.version, row.channel, row.checkout_session_id, row.immediate_execution_requested])).toEqual([
      ["cgv", "2026-11-01", "paiement_plan", "cs_test_1", true],
      ["cgv", "2026-11-01", "paiement_coaching", "cs_test_2", false],
    ]);
  });

  it("refuses a CGV Acceptance while no CGV version is in effect", async () => {
    await expect(acceptances().acceptAtCheckout(marie, { channel: "paiement_plan", checkoutSessionId: "cs_test_1", immediateExecutionRequested: true })).rejects.toThrow(/CGV/);
  });

  it("lists the Candidate's Acceptances for their Data export, oldest first, without the pseudonym or Stripe's identifier", async () => {
    registry = [version("cgu", "2026-12-01"), version("cgv", "2026-11-01")];
    await acceptances().accept(marie, "2026-12-01");
    now = new Date("2026-12-02T10:00:00Z");
    await acceptances().acceptAtCheckout(marie, { channel: "paiement_plan", checkoutSessionId: "cs_test_1", immediateExecutionRequested: true });
    await acceptances().accept(jean, "2026-12-01");

    expect(await acceptances().of(marie)).toEqual([
      { text: "cgu", version: "2026-12-01", url: "/legal/cgu/2026-12-01", sha256: version("cgu", "2026-12-01").sha256, channel: "premiere_connexion", acceptedAt: new Date("2026-12-01T09:30:00Z") },
      {
        text: "cgv",
        version: "2026-11-01",
        url: "/legal/cgv/2026-11-01",
        sha256: version("cgv", "2026-11-01").sha256,
        channel: "paiement_plan",
        acceptedAt: new Date("2026-12-02T10:00:00Z"),
        immediateExecutionRequested: true,
      },
    ]);
  });

  describe("after an Account deletion", () => {
    beforeEach(async () => {
      registry = [version("cgu", "2026-12-01"), version("cgv", "2026-11-01")];
      await acceptances().accept(marie, "2026-12-01");
      await acceptances().acceptAtCheckout(marie, { channel: "paiement_plan", checkoutSessionId: "cs_test_1", immediateExecutionRequested: true });
      await acceptances().accept(jean, "2026-12-01");
      await database.query(`DELETE FROM candidate WHERE id = $1`, [marie]);
    });

    it("keeps the Acceptance rows, with the pseudonym and the day of the deletion, no email and no name", async () => {
      const kept = (await rows()).filter((row) => row.candidate_id === null);

      expect(kept).toHaveLength(2);
      for (const row of kept) {
        expect(row.holder).toEqual(acceptances().holderOf("marie.dupont@example.fr"));
        expect(row.account_deleted_at).toBeInstanceOf(Date);
        expect(JSON.stringify(row)).not.toMatch(/marie|dupont/i);
      }
      const { rows: columns } = await database.query<{ column: string }>(
        `SELECT column_name AS column FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'legal_acceptance'`,
      );
      expect(columns.map((row) => row.column).filter((column) => /email|name|ip|agent/.test(column))).toEqual([]);
    });

    it(`purges the CGU ones ${CGU_RETENTION_YEARS} years after the deletion, the CGV ones ${CGV_RETENTION_YEARS} years after, and never a living Candidate's`, async () => {
      const deletedAt = (await rows()).find((row) => row.candidate_id === null)!.account_deleted_at as Date;
      const yearsAfter = (years: number) => new Date(Date.UTC(deletedAt.getUTCFullYear() + years, deletedAt.getUTCMonth(), deletedAt.getUTCDate() + 1));

      expect(await purgeExpiredAcceptances(database, yearsAfter(CGU_RETENTION_YEARS - 1))).toBe(0);
      expect(await purgeExpiredAcceptances(database, yearsAfter(CGU_RETENTION_YEARS))).toBe(1);
      expect((await rows()).map((row) => [row.candidate_id, row.text])).toEqual([
        [null, "cgv"],
        [jean, "cgu"],
      ]);
      expect(await purgeExpiredAcceptances(database, yearsAfter(CGV_RETENTION_YEARS))).toBe(1);
      expect((await rows()).map((row) => [row.candidate_id, row.text])).toEqual([[jean, "cgu"]]);
      expect(await purgeExpiredAcceptances(database, yearsAfter(CGV_RETENTION_YEARS))).toBe(0);
    });
  });
});
