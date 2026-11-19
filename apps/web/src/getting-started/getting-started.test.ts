import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { recordExtensionAction } from "../extension-events";
import { migrateDatabase } from "../migrations";
import { recordArrivals } from "../offer-box";
import { readGettingStarted } from "./index";

// #1069: what « Pour bien commencer » reads of an account, on the server. Only while the account is in its first 14 days:
// after, nothing is read and nothing is shown.

const DAY = 24 * 60 * 60 * 1000;

describe.skipIf(!connectionString)("readGettingStarted (#1069; needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let marie: { id: string; createdAt: Date };
  let now: Date;

  async function candidate(email: string) {
    const cookie = await signInWithMagicLink(testAuth, email);
    const { user } = await (await testAuth.request("/api/auth/get-session", { cookie })).json();
    return { id: user.id as string, createdAt: new Date(user.createdAt) };
  }

  async function profileOf(candidateId: string): Promise<string> {
    const { rows } = await database.query<{ id: string }>(
      `INSERT INTO profile (candidate_id, name, target_role, locations) VALUES ($1, 'Finance', 'Directrice financière', '{Lyon}') RETURNING id`,
      [candidateId],
    );
    return rows[0]!.id;
  }

  async function jobOffer(): Promise<string> {
    const { rows } = await database.query<{ id: string }>(
      `INSERT INTO job_offer (content_fingerprint, title, content) VALUES (md5(random()::text), 'Directrice financière', 'Un poste.') RETURNING id`,
    );
    return rows[0]!.id;
  }

  const read = (extensionPublished = true, at = now) => readGettingStarted(database, marie, { extensionPublished, now: at });

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateDatabase(testAuth.config);
    marie = await candidate("marie.dupont@example.fr");
    now = new Date(marie.createdAt.getTime() + DAY);
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  it("reads a new account as having used nothing yet, with the extension published or not", async () => {
    expect(await read()).toEqual({ createdAt: marie.createdAt.toISOString(), atsScore: false, extensionCapture: false, extensionPublished: true });
    expect(await read(false)).toMatchObject({ extensionPublished: false });
  });

  it("sees an ATS Score of any of the account's CVs, never another Candidate's", async () => {
    const other = await candidate("paul.martin@example.fr");
    await database.query(`INSERT INTO ats_score (profile_id, version, score) VALUES ($1, 1, '{}')`, [await profileOf(other.id)]);
    expect(await read()).toMatchObject({ atsScore: false });

    await profileOf(marie.id);
    await database.query(`INSERT INTO ats_score (profile_id, version, score) VALUES ($1, 1, '{}')`, [await profileOf(marie.id)]);
    expect(await read()).toMatchObject({ atsScore: true });
  });

  it("sees a Capture from the extension: its Extension Event, or an Arrival source « Extension »", async () => {
    await recordExtensionAction(database, { candidateId: null, extensionVersion: "0.2.0" }, "capture");
    await recordExtensionAction(database, { candidateId: marie.id, extensionVersion: "0.2.0" }, "match_score");
    expect(await read()).toMatchObject({ extensionCapture: false });

    await recordExtensionAction(database, { candidateId: marie.id, extensionVersion: "0.2.0" }, "capture");
    expect(await read()).toMatchObject({ extensionCapture: true });

    await database.query(`DELETE FROM extension_event`);
    const profileId = await profileOf(marie.id);
    await recordArrivals(database, { candidateId: marie.id, profileId, source: "share", at: now, jobOfferIds: [await jobOffer()] });
    expect(await read()).toMatchObject({ extensionCapture: false });
    await recordArrivals(database, { candidateId: marie.id, profileId, source: "extension", at: now, jobOfferIds: [await jobOffer()] });
    expect(await read()).toMatchObject({ extensionCapture: true });
  });

  it("reads nothing once the account's 14 days are over", async () => {
    expect(await read(true, new Date(marie.createdAt.getTime() + 14 * DAY - 1))).not.toBeNull();
    expect(await read(true, new Date(marie.createdAt.getTime() + 14 * DAY))).toBeNull();
  });
});
