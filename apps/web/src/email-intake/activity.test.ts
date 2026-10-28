import { createSecretKey, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createAesGcmCipher } from "../provider-secrets/cipher";
import { createEmailIntakeActivity, type EmailIntakeActivity } from "./activity";
import { alertEmail, inboundItem, inboundPayload, unknownSenderEmail } from "./fixtures/brevo-inbound";
import { createEmailIntake, migrateEmailIntake, type EmailIntake } from "./index";
import { createEmailIntakeInbound, type EmailIntakeInbound } from "./inbound";

const SECRET = "brevo-inbound-test-secret-0123456789";
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

  const post = (...items: Parameters<typeof inboundPayload>) =>
    inbound.handle(
      new Request("http://localhost:3000/api/email-intake/inbound", {
        method: "POST",
        headers: { "content-type": "application/json", "x-inbound-secret": SECRET },
        body: JSON.stringify(inboundPayload(...items)),
      }),
    );

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
      cipher: () => cipher,
      queue: { send: async () => {} },
      settings: () => ({ secret: SECRET, brevoIpRanges: [], dailyCap: 1 }),
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
    await post(inboundItem({ from: MARIE.email, to: address, text: "TR: Offre de Responsable marketing" }));

    const rows = await activity.receivedEmails({});

    expect(rows.map(({ receivedAt, senderDomain, outcome, manualForward }) => ({ receivedAt, senderDomain, outcome, manualForward }))).toEqual([
      { receivedAt: new Date("2026-10-27T10:05:00Z"), senderDomain: "example.fr", outcome: "over_daily_cap", manualForward: true },
      { receivedAt: new Date("2026-10-27T10:00:00Z"), senderDomain: "cabinet-fictif.test", outcome: "unrecognised_sender", manualForward: false },
      { receivedAt: new Date("2026-10-27T09:30:00Z"), senderDomain: "alertes.cadremploi.fr", outcome: "awaiting_reading", manualForward: false },
    ]);
    const shown = JSON.stringify(rows);
    for (const named of [marie, MARIE.email, MARIE.name, address, "Responsable marketing", "Chef de projet"]) expect(shown).not.toContain(named);
  });
});
