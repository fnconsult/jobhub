import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { migrateDatabase } from "../migrations";
import { coachAssociations, associationDataOf, type AssociationPerson, type Invitation } from "./index";
import { coachingOffers, JOBBBOX_SELLER } from "../coaching-offers";
const EMAIL = "association-manager@example.test";
describe.skipIf(!connectionString)("Association business workspace without Candidate access", () => {
  let auth: TestAuth, manager: AssociationPerson, coach: AssociationPerson, id: string, clock: Date;
  let associations: ReturnType<typeof coachAssociations>;
  const mail = vi.fn<(invitation: Invitation, token: string) => Promise<void>>(async () => {});
  let permitted: boolean;
  async function person(email: string): Promise<AssociationPerson> {
    const cookie = await signInWithMagicLink(auth, email);
    return (await (await auth.request("/api/auth/get-session", { cookie })).json()).user;
  }
  beforeEach(async () => {
    auth = await startTestAuth();
    await migrateDatabase(auth.config);
    manager = await person(EMAIL);
    coach = await person("association-coach@example.test");
    id = (
      await auth.database.query(
        "INSERT INTO coach_association(name,legal_status,siret,contract_pending) VALUES('Transitions','Association loi 1901','12345678901234',false) RETURNING id",
      )
    ).rows[0].id;
    await auth.database.query("INSERT INTO coach_association_manager VALUES($1,$2)", [id, manager.id]);
    clock = new Date("2026-11-10T12:00:00Z");
    permitted = true;
    mail.mockReset();
    mail.mockResolvedValue(undefined);
    associations = coachAssociations(auth.database, {
      secret: "test-association-secret",
      now: () => clock,
      mayManage: async () => permitted,
      sendInvitation: mail,
    });
  }, 60000);
  afterEach(async () => {
    await auth.stop();
  }, 60000);
  async function invite(role: "coach" | "manager" = "coach", recipient = coach) {
    const result = await associations.invite(manager, id, { role, name: "Invited Partner", email: recipient.email, locale: "fr" });
    expect(result.ok).toBe(true);
    await associations.deliverInvitations();
    const call = mail.mock.calls.at(-1)!;
    return { id: result.ok ? result.id : "", token: call[1] };
  }
  it("requires a verified current member and their contract for every business read and mutation", async () => {
    for (const outsider of [coach, { ...manager, emailVerified: false }, { ...manager, id: coach.id }]) {
      expect(await associations.managed(outsider)).toEqual([]);
      expect(await associations.coaches(outsider, id)).toBeNull();
      expect(await associations.offers(outsider, id)).toBeNull();
      expect(await associations.members(outsider, id)).toBeNull();
      expect(await associations.invitations(outsider, id)).toBeNull();
      expect(await associations.invite(outsider, id, { role: "coach", name: "Other coach", email: coach.email })).toMatchObject({ ok: false });
    }
    permitted = false;
    expect(await associations.coaches(manager, id)).toBeNull();
    expect(await associations.saveOffer(manager, id, { coachId: crypto.randomUUID(), seller: "jobbbox", durationMinutes: 60, amount: null })).toBe(false);
  });
  it("deduplicates invitations and binds acceptance to the verified recipient and unexpired signature, without GET mutation", async () => {
    const pending = await invite();
    expect(await associations.invitation(coach, pending.id, pending.token)).toMatchObject({ acceptedAt: null });
    expect(await associations.accept(manager, pending.id, pending.token)).toEqual({ ok: false, error: "not_found" });
    expect(await associations.accept({ ...coach, emailVerified: false }, pending.id, pending.token)).toMatchObject({ ok: false });
    expect(await associations.accept(coach, pending.id, "0".repeat(64))).toMatchObject({ ok: false });
    const duplicate = await associations.invite(manager, id, { role: "coach", name: "Other label", email: coach.email });
    expect(duplicate).toEqual({ ok: true, id: pending.id });
    expect(await associations.deliverInvitations()).toBe(0);
    const accepted = await Promise.all([associations.accept(coach, pending.id, pending.token), associations.accept(coach, pending.id, pending.token)]);
    expect(accepted.every((r) => r.ok)).toBe(true);
    const coaches = await associations.coaches(manager, id);
    expect(coaches).toEqual([expect.objectContaining({ email: coach.email, contractPending: true })]);
    expect((await auth.database.query("SELECT public_ready,contract_pending FROM human_coach")).rows[0]).toEqual({
      public_ready: false,
      contract_pending: true,
    });
    expect(JSON.stringify(coaches)).not.toContain("candidateId");
    expect(await associations.providers([coaches![0]!.id])).toEqual([{ coachId: coaches![0]!.id, id, name: "Transitions" }]);
  });
  it("separates manager membership from Coach identity and refuses invitations after expiry, cancellation or inviter departure", async () => {
    const pending = await invite("manager");
    expect(await associations.accept(coach, pending.id, pending.token)).toEqual({ ok: true, role: "manager" });
    expect(await associations.managed(coach)).toHaveLength(1);
    expect((await auth.database.query("SELECT id FROM human_coach")).rows).toEqual([]);
    const third = await person("another-invitee@example.test"),
      other = await invite("coach", third);
    await associations.cancelInvitation(manager, id, other.id);
    expect(await associations.accept(third, other.id, other.token)).toMatchObject({ ok: false });
    const expired = await invite("coach", third);
    clock = new Date(+clock + 8 * 86400000);
    expect(await associations.invitation(third, expired.id, expired.token)).toBeNull();
    clock = new Date(+clock - 8 * 86400000);
    await auth.database.query("DELETE FROM coach_association_manager WHERE association_id=$1 AND candidate_id=$2", [id, manager.id]);
    expect(await associations.accept(third, expired.id, expired.token)).toMatchObject({ ok: false });
  });
  it("retires a removed Coach globally, preserves paid sessions, and gives a retired re-applicant a new identity", async () => {
    const pending = await invite();
    await associations.accept(coach, pending.id, pending.token);
    const before = (await associations.coaches(manager, id))![0]!;
    await auth.database.query(
      "INSERT INTO coaching_session(candidate_id,coach_id,stripe_checkout_session_id,amount,currency) VALUES($1,$2,'cs-association-history',9000,'eur')",
      [manager.id, before.id],
    );
    expect(await associations.retireCoach(coach, id, before.id)).toBe(false);
    expect(await associations.retireCoach(manager, id, before.id)).toBe(true);
    expect(await associations.providers([before.id])).toEqual([]);
    expect((await auth.database.query("SELECT coach_id FROM coaching_session")).rows).toEqual([{ coach_id: before.id }]);
    expect(await associations.accept(coach, pending.id, pending.token)).toMatchObject({ ok: false });
    const next = await invite();
    await associations.accept(coach, next.id, next.token);
    const active = (await associations.coaches(manager, id))!.find((c) => !c.retiredAt)!;
    expect(active.id).not.toBe(before.id);
  });
  it("only changes member offers, preserves administrator Commission, and never enables third-party payment", async () => {
    const pending = await invite();
    await associations.accept(coach, pending.id, pending.token);
    const coachId = (await associations.coaches(manager, id))![0]!.id;
    const offers = coachingOffers(auth.database, { price: async () => ({ amount: 9000, currency: "eur" }) });
    const legacy = await offers.saveSeller({
      kind: "association",
      name: "Transitions",
      status: "Association loi 1901",
      siret: "12345678901234",
      commissionBps: 1750,
    });
    expect(await associations.saveOffer(manager, id, { coachId, seller: "association", durationMinutes: 90, amount: 12500, commissionBps: 9999 })).toBe(true);
    expect(await offers.offer(coachId)).toMatchObject({ seller: { id: legacy!.id }, commissionBps: 1750, amount: 12500, durationMinutes: 90 });
    expect(await offers.sale(manager.id, coachId)).toBeNull();
    const outside = (
      await auth.database.query("INSERT INTO human_coach(name,email,booking_url) VALUES('Independent','independent@example.test','') RETURNING id")
    ).rows[0].id;
    expect(await associations.saveOffer(manager, id, { coachId: outside, seller: "association", durationMinutes: 60, amount: 10000 })).toBe(false);
    expect(await offers.saveOffer({ coachId: outside, sellerId: legacy!.id, durationMinutes: 60, amount: 10000 })).toBe(false);
    expect(await associations.saveOffer(manager, id, { coachId, seller: "jobbbox", durationMinutes: 60, amount: null })).toBe(true);
    expect(await offers.sale(manager.id, coachId)).toMatchObject({ seller: JOBBBOX_SELLER, amount: 9000 });
  });
  it("keeps another Association's members and business data private and cannot silently move its Coach", async () => {
    const pending = await invite();
    await associations.accept(coach, pending.id, pending.token);
    const otherId = (
      await auth.database.query(
        "INSERT INTO coach_association(name,legal_status,siret,contract_pending) VALUES('Other','Association','12345678901235',false) RETURNING id",
      )
    ).rows[0].id;
    expect(await associations.coaches(manager, otherId)).toBeNull();
    await auth.database.query("INSERT INTO coach_association_manager VALUES($1,$2)", [otherId, manager.id]);
    const second = await associations.invite(manager, otherId, { role: "coach", name: "Invited Partner", email: coach.email });
    await associations.deliverInvitations();
    const token = mail.mock.calls.at(-1)![1];
    expect(await associations.accept(coach, second.ok ? second.id : "", token)).toEqual({ ok: false, error: "conflict" });
  });
  it("serializes simultaneous invitations from different Associations for a new Coach", async () => {
    const recipient = await person("concurrent-coach@example.test");
    const secondId = (
      await auth.database.query(
        "INSERT INTO coach_association(name,legal_status,siret,contract_pending) VALUES('Second','Association','12345678901235',false) RETURNING id",
      )
    ).rows[0].id;
    await auth.database.query("INSERT INTO coach_association_manager VALUES($1,$2)", [secondId, manager.id]);
    const first = await associations.invite(manager, id, { role: "coach", name: "Concurrent", email: recipient.email });
    const second = await associations.invite(manager, secondId, { role: "coach", name: "Concurrent", email: recipient.email });
    await associations.deliverInvitations();
    const calls = mail.mock.calls;
    const result = await Promise.all(
      [first, second].map((record) =>
        associations.accept(recipient, record.ok ? record.id : "", calls.find(([invitation]) => record.ok && invitation.id === record.id)![1]),
      ),
    );
    expect(result.filter((r) => r.ok)).toHaveLength(1);
    expect(result.filter((r) => !r.ok && r.error === "conflict")).toHaveLength(1);
    expect((await auth.database.query("SELECT * FROM coach_association_coach WHERE removed_at IS NULL")).rows).toHaveLength(1);
  });
  it("does not export invitations or Coach membership through an unverified email-only match", async () => {
    const pending = await invite();
    await auth.database.query('UPDATE candidate SET "emailVerified"=false WHERE id=$1', [coach.id]);
    expect((await associationDataOf(auth.database, coach.id)).invitationsReceived).toEqual([]);
    await auth.database.query('UPDATE candidate SET "emailVerified"=true WHERE id=$1', [coach.id]);
    await associations.accept(coach, pending.id, pending.token);
    expect((await associationDataOf(auth.database, coach.id)).coachMemberships).toHaveLength(1);
    await auth.database.query('UPDATE candidate SET "emailVerified"=false WHERE id=$1', [coach.id]);
    const exported = await associationDataOf(auth.database, coach.id);
    expect(exported.coachMemberships).toEqual([]);
    expect(exported.invitationsReceived).toEqual([expect.objectContaining({ id: pending.id })]);
  });
  it("does not starve later invitations when the oldest recipient fails and exports no token or other recipient's contact", async () => {
    const first = await associations.invite(manager, id, { role: "coach", name: "First", email: coach.email });
    clock = new Date(+clock + 1000);
    await associations.invite(manager, id, { role: "coach", name: "Second", email: "later-invite@example.test" });
    mail.mockImplementation(async (record) => {
      if (record.email === coach.email) throw new Error("Recipient rejected");
    });
    expect(await associations.deliverInvitations()).toBe(1);
    expect(await associations.deliverInvitations()).toBe(0);
    expect(mail).toHaveBeenCalledTimes(2);
    const mine = await associationDataOf(auth.database, manager.id);
    expect(mine.invitationsSent).toHaveLength(2);
    expect(JSON.stringify(mine)).not.toContain(coach.email);
    expect(JSON.stringify(mine)).not.toContain("notice_claim");
    const received = await associationDataOf(auth.database, coach.id);
    expect(received.invitationsReceived).toEqual([expect.objectContaining({ id: first.ok ? first.id : "", email: coach.email })]);
    clock = new Date(+clock + 40 * 86400000);
    expect(await associations.purge()).toBe(2);
    clock = new Date("2030-01-01T00:00:00Z");
    expect(await associations.purge()).toBe(2);
    expect((await associationDataOf(auth.database, manager.id)).activity).toEqual([]);
  });
});
