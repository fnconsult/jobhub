import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { migrateDatabase } from "../migrations";
import type { LegalTextVersionRecord, LegalTextVersion } from "@jobhub/help";
import { coachContracts, coachContractAcceptancesOf, type ContractPerson } from "./index";
const fixture = (version: string, change: LegalTextVersionRecord["change"] = "substantielle"): LegalTextVersionRecord => ({
  text: "contrat-coach",
  version,
  change,
  url: `/espace-coach/contrat/versions/${version}`,
  sha256: version.replaceAll("-", "").padEnd(64, "0"),
});
describe.skipIf(!connectionString)("versioned private B2B contract", () => {
  let auth: TestAuth, person: ContractPerson, id: string, candidateId: string, registry: LegalTextVersionRecord[], clock: Date;
  const notice = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
  let contracts: ReturnType<typeof coachContracts>;
  beforeEach(async () => {
    auth = await startTestAuth();
    await migrateDatabase(auth.config);
    const cookie = await signInWithMagicLink(auth, "contract-coach@example.test");
    const user = (await (await auth.request("/api/auth/get-session", { cookie })).json()).user;
    person = user;
    candidateId = user.id;
    id = (
      await auth.database.query(
        `INSERT INTO human_coach(name,email,booking_url,contract_pending,public_ready) VALUES('Test coach',$1,'',true,false) RETURNING id`,
        [person.email],
      )
    ).rows[0].id;
    registry = [fixture("2026-01-01")];
    clock = new Date("2026-11-10T12:00:00Z");
    notice.mockReset();
    notice.mockResolvedValue(undefined);
    contracts = coachContracts(auth.database, {
      secret: "test-contract-secret",
      registry: () => registry,
      now: () => clock,
      production: true,
      sendNotice: notice,
      written: () =>
        registry.map((r) => ({
          text: r.text,
          locale: "fr",
          effective: r.version,
          title: "E2E FIXTURE — NO LEGAL VALIDITY",
          change: r.change,
          approvedBy: "Fixture only",
          summary: "Test only",
          inBrief: [],
          sections: [],
        })) as LegalTextVersion[],
    });
  }, 60000);
  afterEach(async () => {
    await auth.stop();
  }, 60000);
  const accept = () => contracts.accept(person, "coach", id, registry.at(-1)!.version, registry.at(-1)!.sha256);
  it("fails closed without a human-approved version, and refuses unverified or unrelated identities", async () => {
    registry = [];
    expect(await contracts.mayEnter(person, id)).toBe(false);
    expect(await contracts.accept(person, "coach", id, "2026-01-01", "anything")).toBe(false);
    expect(await contracts.actors({ ...person, emailVerified: false })).toEqual([]);
    expect(await contracts.state({ ...person, email: "someone-else@example.test" }, "coach", id)).toBeNull();
  });
  it("records a fingerprint and pseudonym once, activates only the subject, and leaves public moderation closed", async () => {
    expect(await contracts.mayEnter(person, id)).toBe(false);
    expect(await contracts.accept(person, "coach", id, registry[0]!.version, "tampered")).toBe(false);
    expect(await accept()).toBe(true);
    expect(await accept()).toBe(true);
    expect(await contracts.mayEnter(person, id)).toBe(true);
    const proof = (await auth.database.query("SELECT * FROM coach_contract_acceptance")).rows;
    expect(proof).toHaveLength(1);
    expect(proof[0].holder).toMatch(/^[0-9a-f]{64}$/);
    expect(proof[0].holder).not.toContain(person.email);
    expect((await auth.database.query("SELECT contract_pending,public_ready FROM human_coach WHERE id=$1", [id])).rows[0]).toEqual({
      contract_pending: false,
      public_ready: false,
    });
    expect(await coachContractAcceptancesOf(auth.database, candidateId)).toEqual([
      expect.objectContaining({ version: registry[0]!.version, sha256: registry[0]!.sha256, origin: "web" }),
    ]);
  });
  it("does not ask again for a minor revision, but closes on a substantial change and refuses stale forms", async () => {
    await accept();
    registry.push(fixture("2026-05-01", "mineure"));
    expect(await contracts.mayEnter(person, id)).toBe(true);
    registry.push(fixture("2026-11-11"));
    expect(await contracts.mayEnter(person, id)).toBe(true);
    clock = new Date("2026-11-11T00:00:00Z");
    expect(await contracts.mayEnter(person, id)).toBe(false);
    expect(await contracts.accept(person, "coach", id, registry[0]!.version, registry[0]!.sha256)).toBe(false);
    expect(await accept()).toBe(true);
    expect((await contracts.state(person, "coach", id))?.history).toHaveLength(2);
  });
  it("keeps Association acceptance separate from its coaches and requires a current manager", async () => {
    const association = (
      await auth.database.query("INSERT INTO coach_association(name,legal_status,siret) VALUES('Test association','association','12345678901234') RETURNING id")
    ).rows[0].id;
    await auth.database.query("INSERT INTO coach_association_manager VALUES($1,$2)", [association, candidateId]);
    expect(await contracts.accept(person, "association", association, registry[0]!.version, registry[0]!.sha256, "mobile")).toBe(true);
    expect((await contracts.state(person, "association", association))?.accepted).toBe(true);
    expect(await contracts.mayEnter(person, id)).toBe(false);
    await auth.database.query("DELETE FROM coach_association_manager WHERE association_id=$1", [association]);
    expect(await contracts.state(person, "association", association)).toBeNull();
  });
  it("denies retired identities even when their contract was accepted", async () => {
    await accept();
    await auth.database.query("UPDATE human_coach SET retired_at=clock_timestamp() WHERE id=$1", [id]);
    expect(await contracts.mayEnter(person, id)).toBe(false);
  });
  it("retains only pseudonymous proof after deletion and purges it at the proposed retention bound", async () => {
    await accept();
    await auth.database.query("DELETE FROM candidate WHERE id=$1", [candidateId]);
    const proof = (await auth.database.query("SELECT candidate_id,account_deleted_at,holder FROM coach_contract_acceptance")).rows[0];
    expect(proof.candidate_id).toBeNull();
    expect(proof.account_deleted_at).toBeInstanceOf(Date);
    clock = new Date(+proof.account_deleted_at + 6 * 366 * 86400000);
    expect(await contracts.purge()).toBe(1);
  });
  it("continues past a failed partner notice and retries only that recipient", async () => {
    registry = [fixture("2027-01-01")];
    const cookie = await signInWithMagicLink(auth, "z-later-partner@example.test");
    const later = (await (await auth.request("/api/auth/get-session", { cookie })).json()).user;
    await auth.database.query("INSERT INTO human_coach(name,email,booking_url) VALUES('Later partner',$1,'')", [later.email]);
    notice.mockImplementation(async (...args: unknown[]) => {
      if ((args[0] as { email: string }).email === person.email) throw new Error("Undeliverable");
    });
    expect(await contracts.sendNotices()).toEqual({ sent: 1, failed: 1 });
    expect(await contracts.sendNotices()).toEqual({ sent: 0, failed: 1 });
  });
  it("announces only future substantial versions to verified active partners, retries failures without starving others, and deduplicates", async () => {
    registry.push(fixture("2027-01-01"), fixture("2027-02-01", "mineure"));
    expect(await contracts.sendNotices()).toEqual({ sent: 1, failed: 0 });
    expect(notice).toHaveBeenCalledTimes(1);
    expect(await contracts.sendNotices()).toEqual({ sent: 0, failed: 0 });
    expect((await auth.database.query("SELECT version FROM coach_contract_notice")).rows).toEqual([{ version: "2027-01-01" }]);
    const off = coachContracts(auth.database, { production: false });
    expect(await off.sendNotices()).toEqual({ sent: 0, failed: 0 });
  });
});
