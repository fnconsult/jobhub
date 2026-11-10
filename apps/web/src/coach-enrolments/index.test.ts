import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { migrateDatabase } from "../migrations";
import { createHumanCoaches } from "../human-coaches";
import { createProfiles } from "../profiles";
import { createApplications } from "../applications";
import { createJobOffers } from "../job-offers";
import { coachEnrolments, type EnrolmentPerson } from "./index";
const input = {
  kind: "coach",
  contactName: "Sophie Martin",
  legalName: "Sophie Conseil",
  email: "sophie-enrol@example.test",
  status: "EI",
  siret: "12345678901234",
  specialties: ["Reconversion"],
  languages: ["français"],
  presentation: "Accompagnement professionnel des cadres en reconversion.",
  locale: "fr",
};
const proof = { name: "qualification.pdf", bytes: Buffer.from("%PDF-test") };
describe.skipIf(!connectionString)("email-owned Coach Enrolment", () => {
  let auth: TestAuth, person: EnrolmentPerson;
  let enrolments: ReturnType<typeof coachEnrolments>;
  let humans: ReturnType<typeof createHumanCoaches>;
  let clock: Date;
  const confirmation = vi.fn(async () => {}),
    decisionNotice = vi.fn<(record: import("./index").Enrolment) => Promise<void>>(async () => {});
  beforeEach(async () => {
    auth = await startTestAuth();
    await migrateDatabase(auth.config);
    const cookie = await signInWithMagicLink(auth, input.email);
    person = (await (await auth.request("/api/auth/get-session", { cookie })).json()).user;
    clock = new Date("2026-11-10T12:00:00Z");
    confirmation.mockClear();
    decisionNotice.mockClear();
    decisionNotice.mockResolvedValue(undefined);
    enrolments = coachEnrolments(auth.database, {
      validateProof: async () => true,
      confirmEmail: confirmation,
      sendDecision: decisionNotice,
      now: () => clock,
    });
    const profiles = createProfiles(auth.database);
    humans = createHumanCoaches(auth.database, {
      profiles,
      applications: createApplications(auth.database, { profiles, jobOffers: createJobOffers(auth.database) }),
      tailoredDocuments: { get: async () => null },
      tailoredCvs: { get: async () => null },
    });
  }, 60_000);
  afterEach(async () => {
    await auth.stop();
  }, 60_000);
  async function submitted() {
    const result = await enrolments.submit(input, proof);
    expect(result.ok && result.id).toBeTruthy();
    return result.ok ? result.id! : "";
  }
  async function confirmed() {
    const id = await submitted();
    expect((await enrolments.confirm(person, id))?.state).toBe("pending");
    return id;
  }
  it("keeps unconfirmed requests out of review and requires a verified owner to confirm or withdraw", async () => {
    const id = await submitted();
    expect(confirmation).toHaveBeenCalledWith(input.email, id, "fr");
    expect(await enrolments.queue()).toEqual([]);
    expect(await enrolments.proof(id)).toBeNull();
    expect(await enrolments.confirm({ ...person, emailVerified: false }, id)).toBeNull();
    expect(await enrolments.confirm({ ...person, id: "other-person", email: "other@example.test" }, id)).toBeNull();
    expect(await enrolments.withdraw({ ...person, id: "other-person", email: "other@example.test" }, id)).toBe(false);
    expect(await enrolments.decide(id, "approve", null)).toEqual({ ok: false, error: "not_found" });
    expect((await enrolments.confirm(person, id))?.state).toBe("pending");
    expect((await enrolments.proof(id))?.bytes).toEqual(proof.bytes);
    expect(await enrolments.withdraw(person, id)).toBe(true);
    expect(await enrolments.owned(person, id)).toBeNull();
  });
  it("deduplicates concurrent email submissions without another confirmation or identity", async () => {
    const results = await Promise.all([enrolments.submit(input, proof), enrolments.submit(input, proof)]);
    expect(results.every((x) => x.ok)).toBe(true);
    expect(confirmation).toHaveBeenCalledTimes(1);
    expect((await auth.database.query("SELECT * FROM coach_enrolment")).rows).toHaveLength(1);
  });
  it("requires a refusal reason, includes it in a retried notice, and cannot change an already decided request", async () => {
    const id = await confirmed();
    expect(await enrolments.decide(id, "refuse", " ")).toEqual({ ok: false, error: "invalid" });
    const result = await enrolments.decide(id, "refuse", "  Merci de compléter vos qualifications.  ");
    expect(result).toMatchObject({ ok: true, changed: true, enrolment: { state: "refused", reason: "Merci de compléter vos qualifications." } });
    expect(decisionNotice).not.toHaveBeenCalled();
    decisionNotice.mockRejectedValueOnce(new Error("Mail unavailable"));
    expect(await enrolments.deliverNotices()).toBe(0);
    expect(await enrolments.deliverNotices()).toBe(0);
    clock = new Date(+clock + 5 * 60_000);
    expect(await enrolments.deliverNotices()).toBe(1);
    expect(decisionNotice).toHaveBeenLastCalledWith(expect.objectContaining({ reason: "Merci de compléter vos qualifications." }));
    expect(await enrolments.deliverNotices()).toBe(0);
    expect(await enrolments.decide(id, "approve", null)).toMatchObject({ ok: true, changed: false, enrolment: { state: "refused" } });
    expect(await humans.list({ includePending: true })).toEqual([]);
  });
  it("delivers later decisions when the oldest recipient keeps failing, and defers its retry", async () => {
    const oldest = await confirmed();
    await enrolments.decide(oldest, "refuse", "Première demande refusée.");
    clock = new Date(+clock + 1000);
    const next = await enrolments.submit(input, proof, person);
    const later = next.ok ? next.id! : "";
    await enrolments.decide(later, "refuse", "Deuxième demande refusée.");
    decisionNotice.mockImplementation(async (record) => {
      if (record.id === oldest) throw new Error("Recipient permanently unavailable");
    });
    expect(await enrolments.deliverNotices()).toBe(1);
    expect(decisionNotice.mock.calls.map(([record]) => record.id)).toEqual([oldest, later]);
    expect(await enrolments.deliverNotices()).toBe(0);
    expect(decisionNotice).toHaveBeenCalledTimes(2);
    clock = new Date(+clock + 5 * 60_000);
    expect(await enrolments.deliverNotices()).toBe(0);
    expect(decisionNotice).toHaveBeenCalledTimes(3);
    expect((await auth.database.query("SELECT notice_sent_at FROM coach_enrolment WHERE id=$1", [later])).rows[0].notice_sent_at).not.toBeNull();
  });
  it("approves exactly once, but does not expose the new coach to Candidates or grant workspace access before contract acceptance", async () => {
    const id = await confirmed();
    const results = await Promise.all([enrolments.decide(id, "approve", null), enrolments.decide(id, "approve", null)]);
    expect(results.every((x) => x.ok)).toBe(true);
    expect(results.filter((x) => x.ok && x.changed)).toHaveLength(1);
    expect(await humans.list()).toEqual([]);
    expect(await humans.list({ includePending: true })).toHaveLength(1);
    expect(await humans.coachSignedIn(person)).toBeNull();
    expect(await enrolments.approvedActive(person)).toHaveLength(1);
    const row = (await auth.database.query("SELECT contract_pending,public_ready FROM human_coach")).rows[0];
    expect(row).toEqual({ contract_pending: true, public_ready: false });
    expect(await enrolments.withdraw(person, id)).toBe(false);
  });
  it("allows a retired coach to apply again under a new identity, never reviving the old one", async () => {
    const id = await confirmed();
    const first = await enrolments.decide(id, "approve", null);
    const oldId = first.ok ? first.enrolment.humanCoachId! : "";
    await humans.retire(oldId);
    expect(await enrolments.approvedActive(person)).toEqual([]);
    const second = await enrolments.submit(input, proof, person);
    expect(second.ok && second.id).toBeTruthy();
    const result = await enrolments.decide(second.ok ? second.id! : "", "approve", null);
    expect(result.ok && result.enrolment.humanCoachId).not.toBe(oldId);
    expect((await auth.database.query("SELECT * FROM human_coach")).rows).toHaveLength(2);
    expect((await auth.database.query("SELECT retired_at FROM human_coach WHERE id=$1", [oldId])).rows[0].retired_at).not.toBeNull();
  });
  it("creates an Association and its manager role without a Human Coach or any Candidate access", async () => {
    const result = await enrolments.submit({ ...input, kind: "association" }, proof, person);
    expect(confirmation).not.toHaveBeenCalled();
    const approved = await enrolments.decide(result.ok ? result.id! : "", "approve", null);
    expect(approved).toMatchObject({ ok: true, enrolment: { humanCoachId: null, associationId: expect.any(String) } });
    expect(await humans.list({ includePending: true })).toEqual([]);
    expect(await humans.coachSignedIn(person)).toBeNull();
    expect((await auth.database.query("SELECT candidate_id FROM coach_association_manager")).rows).toEqual([{ candidate_id: person.id }]);
    expect((await auth.database.query("SELECT contract_pending FROM coach_association")).rows[0].contract_pending).toBe(true);
    await auth.database.query("DELETE FROM candidate WHERE id=$1", [person.id]);
    expect((await auth.database.query("SELECT * FROM coach_association_manager")).rows).toHaveLength(0);
    expect((await auth.database.query("SELECT * FROM coach_enrolment")).rows).toHaveLength(0);
  });
  it("purges unconfirmed and refused proofs on their retention bounds, and expires rate-limit counters", async () => {
    const id = await submitted();
    clock = new Date("2026-11-18T12:00:00Z");
    expect(await enrolments.purge()).toBe(1);
    expect(await enrolments.owned(person, id)).toBeNull();
    const next = await confirmed();
    await enrolments.decide(next, "refuse", "Qualifications manquantes.");
    clock = new Date("2027-06-01T12:00:00Z");
    expect(await enrolments.purge()).toBe(1);
    for (let i = 0; i < 5; i++) expect(await enrolments.allowSubmission("a".repeat(64))).toBe(true);
    expect(await enrolments.allowSubmission("a".repeat(64))).toBe(false);
    clock = new Date(+clock + 3600000);
    expect(await enrolments.allowSubmission("a".repeat(64))).toBe(true);
    clock = new Date(+clock + 3 * 86400000);
    await enrolments.purge();
    expect((await auth.database.query("SELECT * FROM coach_enrolment_rate_limit")).rows).toHaveLength(0);
  });
  it("validates contact fields and PDF content before storing any proof", async () => {
    expect(await enrolments.submit({ ...input, siret: "123" }, proof)).toEqual({ ok: false, error: "invalid" });
    expect(await enrolments.submit(input, { ...proof, name: "proof.html" })).toEqual({ ok: false, error: "invalid" });
    expect(await enrolments.submit(input, { ...proof, bytes: Buffer.from("not a pdf") })).toEqual({ ok: false, error: "invalid" });
    expect((await auth.database.query("SELECT * FROM coach_enrolment")).rows).toHaveLength(0);
  });
});
