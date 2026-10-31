import { createSecretKey, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createAesGcmCipher, type SecretCipher } from "../provider-secrets/cipher";
import { alertEmail, authenticationResults, inboundEmail, inboundRequest, unknownSenderEmail, type InboundTestEmail } from "./fixtures/inbound-emails";
import { createEmailIntake, emailIntakeOf, migrateEmailIntake, type EmailIntake } from "./index";
import { createCandidateSenders } from "./candidate-senders";
import { createEmailIntakeInbound, EMAIL_INTAKE_READ_QUEUE, inIpRanges, MAX_MESSAGE_BYTES, purgeReceivedOfferEmails, receivedTextOf, type EmailIntakeInbound, type InboundSettings } from "./inbound";

const SECRET = "email-intake-test-secret-0123456789";
/** The MTA's address on the stack's own network, as Next.js adds it to X-Forwarded-For when no proxy did. */
const MTA_IP = "172.18.0.5";

describe.skipIf(!connectionString)("Email intake: the emails its MTA posts (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let marie: string;
  let address: string;
  let now: Date;
  let emailIntake: EmailIntake;
  let cipher: SecretCipher;
  let sent: { name: string; data: object }[];
  let settings: InboundSettings;
  let inbound: EmailIntakeInbound;
  let switchedOn: boolean;

  /** Posts each email as the MTA does, one request each, in turn; the last answer. */
  async function deliver(...emails: InboundTestEmail[]): Promise<Response> {
    let response: Response | undefined;
    for (const email of emails) response = await post(email);
    return response!;
  }
  function post(email: InboundTestEmail | string, headers: Record<string, string> = {}): Promise<Response> {
    const posted = typeof email === "string" ? { headers: { "content-type": "message/rfc822" }, body: email } : inboundRequest(email);
    return inbound.handle(
      new Request("http://localhost:3000/api/email-intake/inbound", {
        method: "POST",
        headers: { ...posted.headers, "x-inbound-secret": SECRET, "x-forwarded-for": MTA_IP, ...headers },
        body: posted.body,
      }),
    );
  }
  const received = async () => (await emailIntakeOf(database, marie)).receivedOfferEmails;

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateEmailIntake(database);
    await migrateEmailIntake(database); // safe to run twice
    const cookie = await signInWithMagicLink(testAuth, "marie.dupont@example.fr");
    marie = (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id;
    now = new Date("2026-10-27T09:30:00Z");
    emailIntake = createEmailIntake(database, { domain: () => "alertes.jobbbox.test", now: () => now });
    address = (await emailIntake.switchOn(marie)).address;
    cipher = createAesGcmCipher(new Map([[1, createSecretKey(randomBytes(32))]]));
    sent = [];
    settings = { secret: SECRET, mtaIpRanges: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"], dailyCap: 3 };
    switchedOn = true;
    inbound = createEmailIntakeInbound(database, {
      emailIntake,
      switchedOn: async () => switchedOn,
      cipher: () => cipher,
      queue: { send: async (name, data) => void sent.push({ name, data }) },
      settings: () => settings,
      now: () => now,
    });
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  describe("from whom it takes them", () => {
    it("refuses a delivery without the shared secret, or with another one: 401, nothing received", async () => {
      expect((await post(alertEmail(address), { "x-inbound-secret": "" })).status).toBe(401);
      expect((await post(alertEmail(address), { "x-inbound-secret": "not-the-secret" })).status).toBe(401);

      expect(await received()).toEqual([]);
      expect(sent).toEqual([]);
    });

    it("takes the secret as a bearer token too", async () => {
      const response = await post(alertEmail(address), { "x-inbound-secret": "", authorization: `Bearer ${SECRET}` });

      expect(response.status).toBe(200);
    });

    it("refuses every delivery while no secret is set", async () => {
      settings = { ...settings, secret: undefined };

      expect((await post(alertEmail(address))).status).toBe(401);
    });

    it("refuses a delivery from outside the MTA's own network, such as one through the public proxy: 403; no ranges set, it checks none", async () => {
      expect((await post(alertEmail(address), { "x-forwarded-for": "203.0.113.7" })).status).toBe(403);
      // The address the host's proxy added, the last one, is the one that counts.
      expect((await post(alertEmail(address), { "x-forwarded-for": `${MTA_IP}, 203.0.113.7` })).status).toBe(403);
      expect(await received()).toEqual([]);

      settings = { ...settings, mtaIpRanges: [] };
      expect((await post(alertEmail(address), { "x-forwarded-for": "203.0.113.7" })).status).toBe(200);
    });

    it("refuses a body that is not a raw email with a sender: 400", async () => {
      expect((await post("Subject: no sender\r\n\r\nHello")).status).toBe(400);
      expect((await post(alertEmail(address), { "content-type": "application/json" })).status).toBe(400);
      expect(await received()).toEqual([]);
    });

    it("refuses a message over its size cap: 413, nothing received", async () => {
      const response = await post(alertEmail(address), { "content-length": String(MAX_MESSAGE_BYTES + 1) });

      expect(response.status).toBe(413);
      expect(await received()).toEqual([]);
    });
  });

  describe("what it keeps of them", () => {
    it("discards every email unread while Email intake is switched off on the Sources tab (#448): no row, nothing queued", async () => {
      switchedOn = false;

      const response = await deliver(alertEmail(address), alertEmail(address, { messageId: "<other@cadremploi.fr>" }));

      expect(response.status).toBe(200);
      expect(await received()).toEqual([]);
      expect(sent).toEqual([]);

      // Switched on again: the next email is received as before.
      switchedOn = true;
      expect((await deliver(alertEmail(address))).status).toBe(200);
      expect(await received()).toHaveLength(1);
    });

    it("stores a Recognised sender's email, its text encrypted, and queues it for reading", async () => {
      const response = await deliver(alertEmail(address));

      expect(response.status).toBe(200);
      const [email] = await received();
      expect(email).toEqual({ id: expect.any(String), outcome: "awaiting_reading", kind: null, senderDomain: "alertes.cadremploi.fr", receivedAt: now, sentAt: new Date("2026-10-26T22:18:15Z"), offers: [] });
      expect(sent).toEqual([{ name: EMAIL_INTAKE_READ_QUEUE, data: { receivedOfferEmailId: email!.id } }]);
      expect(await receivedTextOf(database, cipher, email!.id)).toContain("Chef de projet digital H/F <https://www.example-jobs.test/offre/1001>");
      const { rows } = await database.query(`SELECT text_ciphertext::text AS stored FROM received_offer_email`);
      expect(rows[0].stored).not.toContain("Chef de projet");
    });

    it("sets an unknown sender's email aside « expéditeur non reconnu »: a row, no text, nothing queued", async () => {
      expect((await deliver(unknownSenderEmail(address))).status).toBe(200);

      const [email] = await received();
      expect(email).toMatchObject({ outcome: "unrecognised_sender", senderDomain: "cabinet-fictif.test" });
      expect(await receivedTextOf(database, cipher, email!.id)).toBeNull();
      expect(sent).toEqual([]);
    });

    it("sets aside a disabled Recognised sender's email as from an unrecognised sender (#448)", async () => {
      await database.query(`UPDATE recognised_sender SET enabled = false WHERE value = 'cadremploi.fr'`);

      expect((await deliver(alertEmail(address))).status).toBe(200);

      expect((await received())[0]).toMatchObject({ outcome: "unrecognised_sender", senderDomain: "alertes.cadremploi.fr" });
      expect(sent).toEqual([]);
    });

    it("after a Candidate adds a sender, reads its next email for them and still sets it aside for another (#450)", async () => {
      const cookie = await signInWithMagicLink(testAuth, "jean.martin@example.fr");
      const jean = (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id as string;
      const jeansAddress = (await emailIntake.switchOn(jean)).address;
      const monster = (to: string, messageId: string) => alertEmail(to, { from: "alertes@mail.monster.fr", messageId });
      await deliver(monster(address, "<first@mail.monster.fr>"));
      expect((await received())[0]).toMatchObject({ outcome: "unrecognised_sender", senderDomain: "mail.monster.fr" });

      expect(await createCandidateSenders(database).add(marie, { sender: "mail.monster.fr", label: "Monster" })).toMatchObject({ ok: true });
      now = new Date(now.getTime() + 60_000);
      await deliver(monster(address, "<next@mail.monster.fr>"), monster(jeansAddress, "<jean@mail.monster.fr>"));

      // The email already set aside is not recovered.
      const maries = await received();
      expect(maries.map(({ outcome }) => outcome)).toEqual(["awaiting_reading", "unrecognised_sender"]);
      expect((await emailIntakeOf(database, jean)).receivedOfferEmails.map(({ outcome }) => outcome)).toEqual(["unrecognised_sender"]);
      expect(sent).toEqual([{ name: EMAIL_INTAKE_READ_QUEUE, data: { receivedOfferEmailId: maries[0]!.id } }]);
    });

    it("sets aside a platform sender's email for a Candidate who switched it off for themselves, not for another (#450)", async () => {
      const cookie = await signInWithMagicLink(testAuth, "jean.martin@example.fr");
      const jean = (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id as string;
      const jeansAddress = (await emailIntake.switchOn(jean)).address;

      expect(await createCandidateSenders(database).switchPlatformSender(marie, "cadremploi.fr", false)).toBe(true);
      await deliver(alertEmail(address), alertEmail(jeansAddress));

      expect((await received()).map(({ outcome }) => outcome)).toEqual(["unrecognised_sender"]);
      expect((await emailIntakeOf(database, jean)).receivedOfferEmails.map(({ outcome }) => outcome)).toEqual(["awaiting_reading"]);
    });

    it("reads a manual forward from the Candidate's own address, and keeps Gmail's forwarding confirmation without queueing it", async () => {
      const forward = inboundEmail({ from: "marie.dupont@example.fr", to: address, text: "TR: Offre de Responsable marketing" });
      const confirmation = inboundEmail({ from: "forwarding-noreply@google.com", to: address, text: "Code de confirmation : 123456789" });

      await deliver(forward, confirmation);

      const emails = await received();
      expect(emails.map(({ outcome, senderDomain }) => [outcome, senderDomain]).sort()).toEqual([
        ["awaiting_reading", "example.fr"],
        ["forwarding_confirmation", "google.com"],
      ]);
      const kept = emails.find(({ outcome }) => outcome === "forwarding_confirmation")!;
      expect(await receivedTextOf(database, cipher, kept.id)).toBe("Code de confirmation : 123456789");
      expect(sent).toHaveLength(1);
    });

    it("discards unread an email to an unknown, replaced or switched-off address: 200, no row", async () => {
      const old = address;
      await emailIntake.replace(marie);

      expect((await deliver(alertEmail(old), alertEmail("inconnue@alertes.jobbbox.test"))).status).toBe(200);

      expect(await received()).toEqual([]);
      expect(sent).toEqual([]);
    });

    it("receives one email delivered twice once", async () => {
      const email = alertEmail(address, { messageId: "<alerte-1@alertes.cadremploi.fr>" });

      await deliver(email);
      await deliver(email);

      expect(await received()).toHaveLength(1);
      expect(sent).toHaveLength(1);
    });

    it("fails with 503 while no master key can encrypt the text, so the MTA defers the email and its sender delivers it again", async () => {
      inbound = createEmailIntakeInbound(database, { emailIntake, switchedOn: async () => true, cipher: () => null, queue: { send: async () => {} }, settings: () => settings, now: () => now });

      expect((await deliver(alertEmail(address))).status).toBe(503);
      expect(await received()).toEqual([]);
    });

    it("keeps nothing when the email cannot be queued: it fails (5xx), so the MTA defers it and its sender delivers it again", async () => {
      inbound = createEmailIntakeInbound(database, {
        switchedOn: async () => true,
        emailIntake,
        cipher: () => cipher,
        queue: { send: async () => Promise.reject(new Error("queue down")) },
        settings: () => settings,
        now: () => now,
      });

      await expect(deliver(alertEmail(address))).rejects.toThrow("queue down");
      expect(await received()).toEqual([]);
    });
  });

  describe("how many it reads a day", () => {
    it("past the daily cap, queues nothing more: each further email is a row « plafond atteint », without its text", async () => {
      for (let n = 0; n < 4; n++) await deliver(alertEmail(address));
      // An unknown sender's does not count against the cap.
      await deliver(unknownSenderEmail(address));

      const outcomes = (await received()).map(({ outcome }) => outcome);
      expect(outcomes.filter((outcome) => outcome === "awaiting_reading")).toHaveLength(3);
      expect(outcomes.filter((outcome) => outcome === "over_daily_cap")).toHaveLength(1);
      expect(sent).toHaveLength(3);
      const over = (await received()).find(({ outcome }) => outcome === "over_daily_cap")!;
      expect(await receivedTextOf(database, cipher, over.id)).toBeNull();
    });

    it("starts again the next day, in French time", async () => {
      now = new Date("2026-10-27T21:00:00Z"); // 22:00 in Paris
      for (let n = 0; n < 3; n++) await deliver(alertEmail(address));
      now = new Date("2026-10-27T23:30:00Z"); // 00:30 the next day in Paris

      await deliver(alertEmail(address));

      expect(sent).toHaveLength(4);
    });
  });

  describe("how long it keeps them", () => {
    it("purges an email's text 72 hours after it arrived, and the email itself 12 months after", async () => {
      await deliver(alertEmail(address));
      const [email] = await received();

      expect(await purgeReceivedOfferEmails(database, new Date("2026-10-30T09:29:00Z"))).toEqual({ texts: 0, emails: 0 });
      expect(await receivedTextOf(database, cipher, email!.id)).not.toBeNull();

      expect(await purgeReceivedOfferEmails(database, new Date("2026-10-30T09:31:00Z"))).toEqual({ texts: 1, emails: 0 });
      expect(await receivedTextOf(database, cipher, email!.id)).toBeNull();
      expect(await received()).toHaveLength(1);

      expect(await purgeReceivedOfferEmails(database, new Date("2027-10-27T09:31:00Z"))).toEqual({ texts: 0, emails: 1 });
      expect(await received()).toEqual([]);
    });
  });

  it("are the Candidate's own: deleted with their account", async () => {
    await deliver(alertEmail(address), unknownSenderEmail(address));

    await database.query(`DELETE FROM candidate WHERE id = $1`, [marie]);

    expect((await database.query(`SELECT count(*)::int AS n FROM received_offer_email`)).rows[0].n).toBe(0);
  });

  it("reads authentication only from the MTA's own stamp, not one the email carried", async () => {
    const forged = alertEmail(address, { from: "jobalerts-noreply@linkedin.com", authentication: ["mx.jobbbox.test; dmarc=fail header.from=linkedin.com", authenticationResults("linkedin.com")] });

    await deliver(forged);

    expect((await received())[0]).toMatchObject({ outcome: "unrecognised_sender" });
  });
});

describe("the MTA's IP ranges", () => {
  it("hold an IPv4 address inside a CIDR range, not one outside; an IPv6 address only as written", () => {
    expect(inIpRanges("1.179.127.255", ["1.179.112.0/20"])).toBe(true);
    expect(inIpRanges("1.179.128.0", ["1.179.112.0/20"])).toBe(false);
    expect(inIpRanges("172.246.240.1", ["1.179.112.0/20", "172.246.240.0/20"])).toBe(true);
    expect(inIpRanges("203.0.113.7", ["0.0.0.0/0"])).toBe(true);
    expect(inIpRanges("::1", ["127.0.0.1/32", "::1"])).toBe(true);
    expect(inIpRanges("::2", ["::1"])).toBe(false);
    expect(inIpRanges(null, ["0.0.0.0/0"])).toBe(false);
  });
});
