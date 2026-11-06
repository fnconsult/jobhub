import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BASE_URL, connectionString } from "../auth/test-support";
import { migrateDatabase } from "../migrations";
import { createThrowawayDatabase, type ThrowawayDatabase } from "../test-support/throwaway-database";
import { backfillConsumption } from "./backfill";
import { consumptionOf, countUse } from "./index";

describe.skipIf(!connectionString)("Consumption backfill: the last 12 months rebuilt from stored results (#800, needs Postgres: DATABASE_URL)", () => {
  let throwaway: ThrowawayDatabase;
  let database: Pool;
  /** #799 was deployed on Friday 6 November 2026: from that day, Consumption is counted live. */
  const LIVE_FROM = "2026-11-06";
  const NOW = new Date("2026-11-10T10:00:00Z");

  beforeEach(async () => {
    throwaway = await createThrowawayDatabase("test_consumption_backfill");
    database = throwaway.pool;
    await migrateDatabase({ database, baseURL: BASE_URL, secret: "test-secret-test-secret-test-secret-0123", mailer: { send: async () => {} } });
    await candidate("marie");
    await candidate("john");
  }, 60_000);
  afterEach(async () => {
    await throwaway.drop();
  }, 60_000);

  async function candidate(id: string) {
    await database.query(`INSERT INTO candidate (id, name, email, "emailVerified", "interfaceLanguage", "createdAt", "updatedAt") VALUES ($1, $1, $2, true, 'fr', $3, $3)`, [
      id,
      `${id}@example.fr`,
      "2025-01-15T10:00:00Z",
    ]);
  }

  async function profile(candidateId: string): Promise<string> {
    const { rows } = await database.query<{ id: string }>(`INSERT INTO profile (candidate_id, name, target_role, locations) VALUES ($1, 'Produit', 'Product Manager', '{Paris}') RETURNING id`, [
      candidateId,
    ]);
    return rows[0]!.id;
  }

  async function application(candidateId: string, profileId: string): Promise<string> {
    const { rows: offer } = await database.query<{ id: string }>(
      `INSERT INTO job_offer (content_fingerprint, title, content) VALUES (gen_random_uuid()::text, 'Product Manager', 'Une offre') RETURNING id`,
    );
    const { rows } = await database.query<{ id: string }>(`INSERT INTO application (candidate_id, job_offer_id, profile_id) VALUES ($1, $2, $3) RETURNING id`, [
      candidateId,
      offer[0]!.id,
      profileId,
    ]);
    return rows[0]!.id;
  }

  async function coachReplies(candidateId: string, ...at: string[]) {
    const { rows } = await database.query<{ id: string }>(`INSERT INTO coach_conversation (candidate_id, title) VALUES ($1, 'Conversation') RETURNING id`, [candidateId]);
    for (const created of at) {
      await database.query(`INSERT INTO coach_message (conversation_id, author, text, created_at) VALUES ($1, 'candidate', 'Bonjour', $2)`, [rows[0]!.id, created]);
      await database.query(`INSERT INTO coach_message (conversation_id, author, text, created_at) VALUES ($1, 'coach', 'Bonjour !', $2)`, [rows[0]!.id, created]);
    }
  }

  async function jobSearch(candidateId: string, profileId: string, startedAt: string, status = "done", jobOfferIds: string[] = []) {
    await database.query(`INSERT INTO job_search (candidate_id, profile_id, status, job_offer_ids, started_at) VALUES ($1, $2, $3, $4, $5)`, [
      candidateId,
      profileId,
      status,
      jobOfferIds,
      startedAt,
    ]);
  }

  async function quotaUse(candidateId: string, quota: string, week: string, used: number) {
    await database.query(`INSERT INTO quota_usage (candidate_id, quota, week, used) VALUES ($1, $2, $3, $4)`, [candidateId, quota, week, used]);
  }

  /** Every Consumption row, oldest first, as « Votre consommation » would read them. */
  async function rows() {
    const { rows } = await database.query<{ candidate: string; day: string; tool: string; count: number }>(
      `SELECT candidate_id AS candidate, day::text AS day, tool, count FROM consumption_day ORDER BY candidate_id, day, tool`,
    );
    return rows;
  }

  it("counts each Tool's stored results on their French day", async () => {
    const marie = await profile("marie");
    const applicationId = await application("marie", marie);
    // 23:30 UTC on the 2nd is the 3rd in Paris.
    await coachReplies("marie", "2026-11-02T09:00:00Z", "2026-11-02T23:30:00Z", "2026-11-03T08:00:00Z");
    await jobSearch("marie", marie, "2026-11-02T10:00:00Z");
    await jobSearch("marie", marie, "2026-11-02T11:00:00Z", "failed"); // its Plan Quota use was given back
    await jobSearch("marie", marie, "2026-11-02T12:00:00Z", "stopped"); // stopped empty: given back too
    const { rows: offers } = await database.query<{ id: string }>(`SELECT id FROM job_offer LIMIT 1`);
    await jobSearch("marie", marie, "2026-11-02T13:00:00Z", "stopped", [offers[0]!.id]); // stopped with a Job Offer: counted
    await database.query(`INSERT INTO tailored_cv (application_id, proposal, saved) VALUES ($1, $2, $3)`, [
      applicationId,
      { proposedAt: "2026-11-04T09:00:00Z" },
      { savedAt: "2026-11-03T09:00:00Z" },
    ]);
    await database.query(`INSERT INTO tailored_document (application_id, kind, language, text, drafted_at) VALUES ($1, 'cover_letter', 'fr', 'Madame', $2), ($1, 'outreach_message', 'fr', 'Bonjour', $3)`, [
      applicationId,
      "2026-11-04T09:00:00Z",
      "2026-11-05T09:00:00Z",
    ]);
    await database.query(`INSERT INTO company_dossier (application_id, dossier, updated_at) VALUES ($1, $2, '2026-11-05T09:00:00Z')`, [applicationId, { builtAt: "2026-11-04T09:00:00Z" }]);
    await database.query(`INSERT INTO master_cv_version (profile_id, version, content, created_at, provenance) VALUES ($1, 1, '{}', '2026-11-02T09:00:00Z', '{}'), ($1, 2, '{}', '2026-11-03T09:00:00Z', NULL)`, [
      marie,
    ]);
    await database.query(`INSERT INTO ats_score (profile_id, version, score, computed_at) VALUES ($1, 1, '{}', '2026-11-03T09:00:00Z')`, [marie]);
    await database.query(
      `INSERT INTO enriched_contact (application_id, provider, provider_person_id, name, found_at, retrieved_at)
       VALUES ($1, 'p', '1', 'Anne', '2026-11-03T09:00:00Z', '2026-11-04T09:00:00Z'), ($1, 'p', '2', 'Paul', '2026-11-03T09:00:00Z', NULL)`,
      [applicationId],
    );
    await coachReplies("john", "2026-11-05T09:00:00Z");

    const report = await backfillConsumption(database, { liveFrom: LIVE_FROM, now: NOW });

    expect(await rows()).toEqual([
      { candidate: "john", day: "2026-11-05", tool: "coach", count: 1 },
      { candidate: "marie", day: "2026-11-02", tool: "coach", count: 1 },
      { candidate: "marie", day: "2026-11-02", tool: "cvReading", count: 1 },
      { candidate: "marie", day: "2026-11-02", tool: "jobSearch", count: 2 },
      { candidate: "marie", day: "2026-11-03", tool: "atsScore", count: 1 },
      { candidate: "marie", day: "2026-11-03", tool: "coach", count: 2 },
      { candidate: "marie", day: "2026-11-03", tool: "tailoredCv", count: 1 },
      { candidate: "marie", day: "2026-11-04", tool: "companyDossier", count: 1 },
      { candidate: "marie", day: "2026-11-04", tool: "enrichedContact", count: 1 },
      { candidate: "marie", day: "2026-11-04", tool: "tailoredCv", count: 1 },
      { candidate: "marie", day: "2026-11-04", tool: "tailoredDocument", count: 1 },
      { candidate: "marie", day: "2026-11-05", tool: "tailoredDocument", count: 1 },
    ]);
    expect(report).toEqual({
      from: "2025-11-10",
      until: LIVE_FROM,
      rows: 12,
      uses: { coach: 4, jobSearch: 2, matchScore: 0, tailoredCv: 2, tailoredDocument: 2, atsScore: 1, companyDossier: 1, enrichedContact: 1, cvReading: 1 },
    });
  });

  it("counts a week's Plan Quota uses no stored result shows on the week's Monday: every Match Score, the ATS Scores replaced since", async () => {
    const marie = await profile("marie");
    await quotaUse("marie", "matchScores", "2026-10-26", 5);
    await quotaUse("marie", "atsScores", "2026-10-26", 3);
    await database.query(`INSERT INTO ats_score (profile_id, version, score, computed_at) VALUES ($1, 1, '{}', '2026-10-28T09:00:00Z')`, [marie]);
    await quotaUse("marie", "jobSearches", "2026-10-26", 1);
    await jobSearch("marie", marie, "2026-10-27T10:00:00Z");
    // The week #799 was deployed in: its uses from the 6th are counted live, so the week's total says nothing of the days before.
    await quotaUse("marie", "matchScores", "2026-11-02", 4);
    // Before weekly Plan Quotas, a month (ADR-0032): not a week.
    await quotaUse("marie", "matchScores", "2026-10", 9);

    await backfillConsumption(database, { liveFrom: LIVE_FROM, now: NOW });

    expect(await rows()).toEqual([
      { candidate: "marie", day: "2026-10-26", tool: "atsScore", count: 2 },
      { candidate: "marie", day: "2026-10-26", tool: "matchScore", count: 5 },
      { candidate: "marie", day: "2026-10-27", tool: "jobSearch", count: 1 },
      { candidate: "marie", day: "2026-10-28", tool: "atsScore", count: 1 },
    ]);
  });

  it("run twice, it gives the same rows; run again after a result is deleted, it replaces what it wrote", async () => {
    const marie = await profile("marie");
    await coachReplies("marie", "2026-11-02T09:00:00Z", "2026-11-03T09:00:00Z");
    await jobSearch("marie", marie, "2026-11-02T10:00:00Z");
    await quotaUse("marie", "matchScores", "2026-10-26", 2);

    await backfillConsumption(database, { liveFrom: LIVE_FROM, now: NOW });
    const first = await rows();
    await backfillConsumption(database, { liveFrom: LIVE_FROM, now: NOW });

    expect(await rows()).toEqual(first);
    expect(first).toHaveLength(4);

    // « Effacer » on the conversation: the next run no longer finds its replies.
    await database.query(`DELETE FROM coach_conversation WHERE candidate_id = 'marie'`);
    await backfillConsumption(database, { liveFrom: LIVE_FROM, now: NOW });
    expect(await rows()).toEqual(first.filter((row) => row.tool !== "coach"));
  });

  it("never touches a day on or after #799's deploy date: the live counts stay as they are", async () => {
    const marie = await profile("marie");
    await coachReplies("marie", "2026-11-05T22:30:00Z", "2026-11-06T09:00:00Z", "2026-11-09T09:00:00Z"); // the first is the 5th's last hour in Paris
    await jobSearch("marie", marie, "2026-11-06T10:00:00Z");
    // Live: counted as they were saved, from the 6th.
    await countUse(database, "marie", "coach", new Date("2026-11-06T09:00:00Z"));
    await countUse(database, "marie", "coach", new Date("2026-11-06T15:00:00Z")); // a reply in a conversation since deleted
    await countUse(database, "marie", "coach", new Date("2026-11-09T09:00:00Z"));
    await countUse(database, "marie", "jobSearch", new Date("2026-11-06T10:00:00Z"));
    const live = await rows();

    await backfillConsumption(database, { liveFrom: LIVE_FROM, now: NOW });
    await backfillConsumption(database, { liveFrom: LIVE_FROM, now: NOW });

    expect(await rows()).toEqual([{ candidate: "marie", day: "2026-11-05", tool: "coach", count: 1 }, ...live]);
  });

  it("writes nothing older than 12 months: the day exactly 12 months ago is the first one written", async () => {
    await coachReplies("marie", "2025-11-08T09:00:00Z", "2025-11-09T09:00:00Z", "2025-11-10T09:00:00Z", "2025-11-11T09:00:00Z");
    await quotaUse("marie", "matchScores", "2025-11-03", 7); // its Monday is more than 12 months old

    const report = await backfillConsumption(database, { liveFrom: LIVE_FROM, now: NOW });

    expect(report.from).toBe("2025-11-10");
    expect(await consumptionOf(database, "marie")).toEqual([
      { day: "2025-11-11", tool: "coach", count: 1 },
      { day: "2025-11-10", tool: "coach", count: 1 },
    ]);
  });

  it("refuses a deploy date it cannot read, or one still to come", async () => {
    await expect(backfillConsumption(database, { liveFrom: "6/11/2026", now: NOW })).rejects.toThrow(/YYYY-MM-DD/);
    await expect(backfillConsumption(database, { liveFrom: "2026-11-11", now: NOW })).rejects.toThrow(/to come/);
    expect(await rows()).toEqual([]);
  });
});
