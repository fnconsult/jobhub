import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { migrateDatabase } from "../migrations";
import { purgeExpiredSharedReading, sharedReading, SHARED_PDF_MAX_BYTES } from "./index";

describe.skipIf(!connectionString)("ephemeral Shared Reading", () => {
  let auth: TestAuth;
  let candidateId: string;
  let coachId: string;
  let otherCoachId: string;
  let sessionId: string;
  let clock: Date;
  const source = { kind: "cover_letter", id: "7edf7432-bc4a-40e7-9442-10c7b0f48066" };
  const document = vi.fn(async () => ({ kind: "text" as const, title: "Application", text: "Private letter" }));
  const validatePdf = vi.fn(async () => true);
  let reading: ReturnType<typeof sharedReading>;
  beforeEach(async () => {
    auth = await startTestAuth();
    await migrateDatabase(auth.config);
    const cookie = await signInWithMagicLink(auth, "reading-candidate@example.test");
    candidateId = (await (await auth.request("/api/auth/get-session", { cookie })).json()).user.id;
    const coaches = await auth.database.query(
      "INSERT INTO human_coach (name,email,booking_url) VALUES ('Reading Coach','reading@example.test','https://cal.com/reading'),('Other Coach','other-reading@example.test','https://cal.com/other') RETURNING id",
    );
    [coachId, otherCoachId] = coaches.rows.map((row) => row.id);
    sessionId = (
      await auth.database.query(
        "INSERT INTO coaching_session (candidate_id,coach_id,stripe_checkout_session_id,amount,currency,scheduled_at,duration_minutes) VALUES ($1,$2,'cs-reading',9000,'eur','2026-11-10T12:00:00Z',60) RETURNING id",
        [candidateId, coachId],
      )
    ).rows[0].id;
    clock = new Date("2026-11-10T12:00:00Z");
    document.mockClear();
    validatePdf.mockClear();
    validatePdf.mockResolvedValue(true);
    reading = sharedReading(auth.database, { document, validatePdf, now: () => clock });
  }, 60_000);
  afterEach(async () => {
    await auth.stop();
  }, 60_000);
  const other = { candidateId: "not-the-owner" };
  it("requires the paid relationship, active coach and session window for each snapshot read", async () => {
    expect(await reading.startCandidate(other, sessionId, source)).toBeNull();
    expect(await reading.startCandidate({ candidateId: "", coachId }, sessionId, source)).toBeNull();
    expect(document).not.toHaveBeenCalled();
    clock = new Date("2026-11-10T11:49:59Z");
    expect(await reading.startCandidate({ candidateId }, sessionId, source)).toBeNull();
    clock = new Date("2026-11-10T11:50:00Z");
    const state = await reading.startCandidate({ candidateId }, sessionId, source);
    expect(state?.presenter).toBe("candidate");
    expect(await reading.document({ candidateId: "", coachId }, sessionId, state!.id)).toMatchObject({ document: { text: "Private letter" } });
    expect(await reading.document({ candidateId: "", coachId: otherCoachId }, sessionId, state!.id)).toBeNull();
    expect(await reading.document(other, sessionId, state!.id)).toBeNull();
    clock = new Date("2026-11-10T13:30:00Z");
    expect(await reading.current({ candidateId }, sessionId)).not.toBeNull();
    clock = new Date("2026-11-10T13:30:00.001Z");
    expect(await reading.document({ candidateId }, sessionId, state!.id)).toBeNull();
    expect((await auth.database.query("SELECT * FROM shared_reading")).rows).toHaveLength(0);
  });
  it("lets only the presenter move, orders positions and invalidates replaced/stopped share IDs", async () => {
    const state = (await reading.startCandidate({ candidateId }, sessionId, source))!;
    expect(await reading.move({ candidateId: "", coachId }, sessionId, state.id, { page: 2, scroll: 0.7, sequence: 1 })).toBe(false);
    expect(await reading.move({ candidateId }, sessionId, state.id, { page: 2, scroll: 0.7, sequence: 2 })).toBe(true);
    expect(await reading.move({ candidateId }, sessionId, state.id, { page: 1, scroll: 0.1, sequence: 1 })).toBe(false);
    expect(await reading.current({ candidateId: "", coachId }, sessionId)).toMatchObject({ page: 2, scroll: 0.7 });
    const replacement = (await reading.startCandidate({ candidateId }, sessionId, source))!;
    expect(replacement.id).not.toBe(state.id);
    expect(await reading.document({ candidateId }, sessionId, state.id)).toBeNull();
    expect(await reading.stop(other, sessionId)).toBe(false);
    expect(await reading.stop({ candidateId: "", coachId }, sessionId)).toBe(true);
    expect(await reading.document({ candidateId }, sessionId, replacement.id)).toBeNull();
  });
  it("validates coach PDFs and keeps them available only to both session participants", async () => {
    const file = { name: "presentation.pdf", bytes: Buffer.from("%PDF-valid") };
    expect(await reading.presentPdf({ candidateId }, sessionId, file)).toBeNull();
    expect(await reading.presentPdf({ candidateId: "", coachId: otherCoachId }, sessionId, file)).toBeNull();
    expect(await reading.presentPdf({ candidateId: "", coachId }, sessionId, { ...file, name: "page.html" })).toBeNull();
    expect(await reading.presentPdf({ candidateId: "", coachId }, sessionId, { ...file, bytes: Buffer.alloc(SHARED_PDF_MAX_BYTES + 1) })).toBeNull();
    validatePdf.mockResolvedValueOnce(false);
    expect(await reading.presentPdf({ candidateId: "", coachId }, sessionId, file)).toBeNull();
    const state = (await reading.presentPdf({ candidateId: "", coachId }, sessionId, file))!;
    expect(state.document).toEqual({ kind: "pdf", title: "presentation.pdf" });
    expect((await reading.document({ candidateId }, sessionId, state.id))?.pdf).toEqual(file.bytes);
    expect(await reading.move({ candidateId: "", coachId }, sessionId, state.id, { page: 3, scroll: 0.5, sequence: 1 })).toBe(true);
    expect(await reading.stop({ candidateId }, sessionId)).toBe(true);
  });
  it("purges expired bytes without a read, and revokes retired, withdrawn or rescheduled sessions", async () => {
    await reading.presentPdf({ candidateId: "", coachId }, sessionId, { name: "p.pdf", bytes: Buffer.from("%PDF-valid") });
    expect(await purgeExpiredSharedReading(auth.database, new Date("2026-11-10T13:31:00Z"))).toBe(1);
    await reading.startCandidate({ candidateId }, sessionId, source);
    await auth.database.query("UPDATE coaching_session SET scheduled_at=scheduled_at+interval '1 day' WHERE id=$1", [sessionId]);
    expect(await reading.current({ candidateId }, sessionId)).toBeNull();
    await auth.database.query("UPDATE coaching_session SET scheduled_at=scheduled_at-interval '1 day' WHERE id=$1", [sessionId]);
    await reading.startCandidate({ candidateId }, sessionId, source);
    await auth.database.query("UPDATE human_coach SET retired_at=now() WHERE id=$1", [coachId]);
    expect(await reading.stop({ candidateId: "", coachId }, sessionId)).toBe(false);
    expect(await reading.stop({ candidateId }, sessionId)).toBe(true);
    expect(await reading.startCandidate({ candidateId }, sessionId, source)).toBeNull();
  });
});
