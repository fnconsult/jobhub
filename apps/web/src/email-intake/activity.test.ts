import { createSecretKey, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createAesGcmCipher } from "../provider-secrets/cipher";
import { createEmailIntakeActivity, purgeEmailIntakeActivity, recordReading, type EmailIntakeActivity } from "./activity";
import { alertEmail, inboundEmail, inboundRequest, unknownSenderEmail, type InboundTestEmail } from "./fixtures/inbound-emails";
import { createEmailIntake, emailIntakeOf, migrateEmailIntake, type EmailIntake } from "./index";
import { createEmailIntakeInbound, type EmailIntakeInbound } from "./inbound";

const SECRET = "email-intake-test-secret-0123456789";
const MARIE = { email: "marie.dupont@example.fr", name: "Marie Dupont" };

describe.skipIf(!connectionString)("Email intake in the Back Office's Activité: « Emails reçus » (#449; needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let marie: string;
  let address: string;
  let now: Date;
  let emailIntake: EmailIntake;
  let inbound: EmailIntakeInbound;
  let activity: EmailIntakeActivity;

  const post = (email: InboundTestEmail) => inbound.handle(new Request("http://localhost:3000/api/email-intake/inbound", { method: "POST", ...inboundRequest(email, SECRET) }));

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateEmailIntake(database);
    const cookie = await signInWithMagicLink(testAuth, MARIE.email);
    marie = (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id;
    await database.query(`UPDATE candidate SET name = $2 WHERE id = $1`, [marie, MARIE.name]);
    now = new Date("2026-10-27T09:30:00Z");
    emailIntake = createEmailIntake(database, { domain: () => "alertes.jobbbox.test", now: () => now });
    address = (await emailIntake.switchOn(marie)).address;
    const cipher = createAesGcmCipher(new Map([[1, createSecretKey(randomBytes(32))]]));
    inbound = createEmailIntakeInbound(database, {
      emailIntake,
      switchedOn: async () => true,
      cipher: () => cipher,
      queue: { send: async () => {} },
      settings: () => ({ secret: SECRET, mtaIpRanges: [], dailyCap: 1 }),
      now: () => now,
    });
    activity = createEmailIntakeActivity(database, { now: () => now });
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  it("lists each Received offer email, newest first: date, sender's domain, outcome; naming no Candidate and nothing of the email's content", async () => {
    await post(alertEmail(address));
    now = new Date("2026-10-27T10:00:00Z");
    await post(unknownSenderEmail(address));
    now = new Date("2026-10-27T10:05:00Z");
    await post(inboundEmail({ from: MARIE.email, to: address, text: "TR: Offre de Responsable marketing" }));

    const rows = await activity.receivedEmails({});

    expect(rows.map(({ receivedAt, senderDomain, outcome, manualForward }) => ({ receivedAt, senderDomain, outcome, manualForward }))).toEqual([
      { receivedAt: new Date("2026-10-27T10:05:00Z"), senderDomain: "example.fr", outcome: "over_daily_cap", manualForward: true },
      { receivedAt: new Date("2026-10-27T10:00:00Z"), senderDomain: "cabinet-fictif.test", outcome: "unrecognised_sender", manualForward: false },
      { receivedAt: new Date("2026-10-27T09:30:00Z"), senderDomain: "alertes.cadremploi.fr", outcome: "awaiting_reading", manualForward: false },
    ]);
    const shown = JSON.stringify(rows);
    for (const named of [marie, MARIE.email, MARIE.name, address, "Responsable marketing", "Chef de projet"]) expect(shown).not.toContain(named);
  });

  it("survive the Candidate's deletion, and are not in their Data export", async () => {
    await post(alertEmail(address));
    const [kept] = (await emailIntakeOf(database, marie)).receivedOfferEmails;
    expect(JSON.stringify(kept)).not.toContain((await activity.receivedEmails({}))[0]!.id);

    await database.query(`DELETE FROM candidate WHERE id = $1`, [marie]);

    expect(await activity.receivedEmails({})).toEqual([expect.objectContaining({ senderDomain: "alertes.cadremploi.fr", outcome: "awaiting_reading" })]);
  });

  it("are purged 24 months after the email arrived, not before", async () => {
    await post(alertEmail(address));
    await database.query(`DELETE FROM candidate WHERE id = $1`, [marie]);

    expect(await purgeEmailIntakeActivity(database, new Date("2028-10-27T09:29:00Z"))).toMatchObject({ receivedEmails: 0 });
    expect(await activity.receivedEmails({ period: "all" })).toHaveLength(1);

    expect(await purgeEmailIntakeActivity(database, new Date("2028-10-27T09:30:00Z"))).toMatchObject({ receivedEmails: 1 });
    expect(await activity.receivedEmails({ period: "all" })).toEqual([]);
  });

  it("show what the reading made of an email: its kind, offers new and already stored, outcome and Guardrail", async () => {
    await post(alertEmail(address));
    const [email] = (await emailIntakeOf(database, marie)).receivedOfferEmails;
    expect((await activity.receivedEmails({}))[0]).toMatchObject({ kind: null, offers: null, guardrail: null });

    await recordReading(database, email!.id, { kind: "alert", newOffers: 3, alreadyStored: 2, outcome: "offers_found", guardrail: "passed" });

    expect((await activity.receivedEmails({}))[0]).toMatchObject({ kind: "alert", offers: { new: 3, alreadyStored: 2 }, outcome: "offers_found", guardrail: "passed" });
  });

  it("filter by outcome, kind and period (Paris day); an unreadable filter is left out", async () => {
    now = new Date("2026-10-20T09:00:00Z");
    await post(unknownSenderEmail(address, { messageId: "<old@cabinet-fictif.test>" }));
    now = new Date("2026-10-27T09:30:00Z");
    await post(alertEmail(address));
    await post(unknownSenderEmail(address));
    const [read] = (await emailIntakeOf(database, marie)).receivedOfferEmails.filter(({ outcome }) => outcome === "awaiting_reading");
    await recordReading(database, read!.id, { kind: "recruiter", newOffers: 1, alreadyStored: 0, outcome: "offers_found", guardrail: "flagged" });
    const domains = async (filter: unknown) => (await activity.receivedEmails(filter)).map(({ senderDomain }) => senderDomain);

    expect(await domains({ outcome: "unrecognised_sender" })).toEqual(["cabinet-fictif.test"]);
    expect(await domains({ outcome: "unrecognised_sender", period: "all" })).toEqual(["cabinet-fictif.test", "cabinet-fictif.test"]);
    expect(await domains({ kind: "recruiter" })).toEqual(["alertes.cadremploi.fr"]);
    expect(await domains({ kind: "alert" })).toEqual([]);
    expect(await domains({ period: "today" })).toHaveLength(2);
    expect(await domains({ period: "30d" })).toHaveLength(3);
    expect(await domains({ outcome: "'; DROP TABLE received_email_activity; --", kind: 42 })).toHaveLength(2);
  });

  describe("the Journal's Linked mailbox events", () => {
    it("are switching on, replacing and switching off a Forwarding address, and the first email past the daily cap each Paris day; naming no Candidate", async () => {
      now = new Date("2026-10-27T10:00:00Z");
      await post(alertEmail(address));
      await post(alertEmail(address)); // past the cap of 1
      await post(alertEmail(address)); // past it again: no second event that day
      now = new Date("2026-10-27T11:00:00Z");
      address = (await emailIntake.replace(marie))!.address;
      now = new Date("2026-10-27T12:00:00Z");
      await emailIntake.switchOff(marie);
      await emailIntake.switchOff(marie); // already off: nothing happens

      const events = await activity.linkedMailboxEvents(10);

      expect(events.map(({ at, event }) => [at.toISOString(), event])).toEqual([
        ["2026-10-27T12:00:00.000Z", "switched_off"],
        ["2026-10-27T11:00:00.000Z", "replaced"],
        ["2026-10-27T10:00:00.000Z", "daily_cap_reached"],
        ["2026-10-27T09:30:00.000Z", "switched_on"],
      ]);
      const shown = JSON.stringify(events);
      for (const named of [marie, MARIE.email, MARIE.name, address]) expect(shown).not.toContain(named);
    });

    it("survive the Candidate's deletion and are purged after 24 months", async () => {
      await database.query(`DELETE FROM candidate WHERE id = $1`, [marie]);
      expect(await activity.linkedMailboxEvents(10)).toHaveLength(1);

      expect(await purgeEmailIntakeActivity(database, new Date("2028-10-27T09:29:00Z"))).toMatchObject({ linkedMailboxEvents: 0 });
      expect(await purgeEmailIntakeActivity(database, new Date("2028-10-27T09:30:00Z"))).toMatchObject({ linkedMailboxEvents: 1 });
      expect(await activity.linkedMailboxEvents(10)).toEqual([]);
    });
  });
});
