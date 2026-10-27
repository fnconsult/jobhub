import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createEmailIntake, migrateEmailIntake, type EmailIntake } from "./index";

describe.skipIf(!connectionString)("Email intake: the Candidate's Forwarding address (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let marie: string;
  let jean: string;
  let now: Date;
  let emailIntake: EmailIntake;

  async function candidate(email: string): Promise<string> {
    const cookie = await signInWithMagicLink(testAuth, email);
    return (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id;
  }

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateEmailIntake(database);
    await migrateEmailIntake(database); // safe to run twice
    marie = await candidate("marie.dupont@example.fr");
    jean = await candidate("jean.martin@example.fr");
    now = new Date("2026-10-27T09:30:00Z");
    emailIntake = createEmailIntake(database, { domain: () => "alertes.jobbbox.test", now: () => now });
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  it("is off until the Candidate switches it on, then shows a long random address on the Email intake domain, dated", async () => {
    expect(await emailIntake.forwardingAddress(marie)).toBeNull();

    const switchedOn = await emailIntake.switchOn(marie);

    expect(switchedOn.address).toMatch(/^[a-z2-7]{16}@alertes\.jobbbox\.test$/);
    expect(switchedOn.activatedAt).toEqual(new Date("2026-10-27T09:30:00Z"));
    expect(await emailIntake.forwardingAddress(marie)).toEqual(switchedOn);
    expect(await emailIntake.forwardingAddress(jean)).toBeNull();
  });

  it("finds the Candidate an email reached by their Forwarding address, whatever its case", async () => {
    const { address } = await emailIntake.switchOn(marie);

    expect(await emailIntake.candidateAt(address)).toBe(marie);
    expect(await emailIntake.candidateAt(` ${address.toUpperCase()} `)).toBe(marie);
    expect(await emailIntake.candidateAt("inconnue@alertes.jobbbox.test")).toBeNull();
  });

  it("keeps the address and its date when switched on again", async () => {
    const first = await emailIntake.switchOn(marie);
    now = new Date("2026-11-02T10:00:00Z");

    expect(await emailIntake.switchOn(marie)).toEqual(first);
  });

  it("replaces the address with a new one, dated, and the old one is unknown to the lookup at once", async () => {
    const old = await emailIntake.switchOn(marie);
    now = new Date("2026-11-02T10:00:00Z");

    const replaced = await emailIntake.replace(marie);

    expect(replaced).toEqual({ address: expect.stringMatching(/^[a-z2-7]{16}@alertes\.jobbbox\.test$/), activatedAt: new Date("2026-11-02T10:00:00Z") });
    expect(replaced!.address).not.toBe(old.address);
    expect(await emailIntake.forwardingAddress(marie)).toEqual(replaced);
    expect(await emailIntake.candidateAt(old.address)).toBeNull();
    expect(await emailIntake.candidateAt(replaced!.address)).toBe(marie);
  });

  it("has nothing to replace while off", async () => {
    expect(await emailIntake.replace(marie)).toBeNull();
    expect(await emailIntake.forwardingAddress(marie)).toBeNull();
  });

  it("switched off, stops the address at once; switched on again, gives a new one with the new date", async () => {
    const old = await emailIntake.switchOn(marie);

    await emailIntake.switchOff(marie);

    expect(await emailIntake.forwardingAddress(marie)).toBeNull();
    expect(await emailIntake.candidateAt(old.address)).toBeNull();

    now = new Date("2026-11-02T10:00:00Z");
    const again = await emailIntake.switchOn(marie);
    expect(again.address).not.toBe(old.address);
    expect(again.activatedAt).toEqual(new Date("2026-11-02T10:00:00Z"));
    expect(await emailIntake.candidateAt(old.address)).toBeNull();
  });

  it("never gives two Candidates the same address, nor one already given and stopped: a drawn one taken is drawn again", async () => {
    const drawn = ["aaaaaaaaaaaaaaaa", "aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb", "bbbbbbbbbbbbbbbb", "cccccccccccccccc"];
    const drawing = createEmailIntake(database, { domain: () => "alertes.jobbbox.test", localPart: () => drawn.shift()!, now: () => now });

    expect((await drawing.switchOn(marie)).address).toBe("aaaaaaaaaaaaaaaa@alertes.jobbbox.test");
    expect((await drawing.switchOn(jean)).address).toBe("bbbbbbbbbbbbbbbb@alertes.jobbbox.test");
    await drawing.switchOff(jean);
    expect((await drawing.switchOn(jean)).address).toBe("cccccccccccccccc@alertes.jobbbox.test");
    expect(await drawing.candidateAt("aaaaaaaaaaaaaaaa@alertes.jobbbox.test")).toBe(marie);
  });

  it("refuses, in the database itself, a second Candidate on an address", async () => {
    const { address } = await emailIntake.switchOn(marie);

    await expect(
      database.query(`INSERT INTO forwarding_address (candidate_id, address, state, activated_at) VALUES ($1, $2, 'active', now())`, [jean, address]),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("knows the Candidate's own sending addresses for manual forwards: their account's, then those they add, kept whether Email intake is on or off", async () => {
    expect(await emailIntake.sendingAddresses(marie)).toEqual(["marie.dupont@example.fr"]);

    expect(await emailIntake.addSendingAddress(marie, " Marie.Pro@Example.com ")).toBe("added");
    now = new Date("2026-10-28T09:30:00Z");
    expect(await emailIntake.addSendingAddress(marie, "marie@orange.fr")).toBe("added");
    expect(await emailIntake.addSendingAddress(marie, "marie.pro@example.com")).toBe("added");
    expect(await emailIntake.addSendingAddress(marie, "MARIE.DUPONT@example.fr")).toBe("added");

    expect(await emailIntake.sendingAddresses(marie)).toEqual(["marie.dupont@example.fr", "marie.pro@example.com", "marie@orange.fr"]);
    expect(await emailIntake.sendingAddresses(jean)).toEqual(["jean.martin@example.fr"]);

    await emailIntake.removeSendingAddress(marie, "Marie.Pro@example.com");
    expect(await emailIntake.sendingAddresses(marie)).toEqual(["marie.dupont@example.fr", "marie@orange.fr"]);
  });

  it("refuses a sending address that is not an email address, or one more than ten", async () => {
    expect(await emailIntake.addSendingAddress(marie, "marie.dupont")).toBe("invalid");
    expect(await emailIntake.addSendingAddress(marie, "marie @orange.fr")).toBe("invalid");
    for (let n = 1; n <= 10; n++) expect(await emailIntake.addSendingAddress(marie, `marie${n}@example.com`)).toBe("added");

    expect(await emailIntake.addSendingAddress(marie, "marie11@example.com")).toBe("too_many");
    expect(await emailIntake.addSendingAddress(marie, "marie10@example.com")).toBe("added");
    expect(await emailIntake.sendingAddresses(marie)).toHaveLength(11);
  });

  it("gives a Candidate one address in use at a time, in the database itself", async () => {
    await emailIntake.switchOn(marie);

    await expect(
      database.query(`INSERT INTO forwarding_address (candidate_id, address, state, activated_at) VALUES ($1, 'zzzzzzzzzzzzzzzz@alertes.jobbbox.test', 'active', now())`, [marie]),
    ).rejects.toMatchObject({ code: "23505" });
  });
});
