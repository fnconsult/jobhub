import { createSecretKey, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createAesGcmCipher, type SecretCipher } from "../provider-secrets/cipher";
import { alertEmail, gmailForwardingConfirmation, inboundPayload, unknownSenderEmail, type BrevoInboundItem } from "./fixtures/brevo-inbound";
import { forwardingSetupOf } from "./forwarding-setup";
import { createEmailIntakeInbound, type EmailIntakeInbound } from "./inbound";
import { createEmailIntake, migrateEmailIntake, type EmailIntake } from "./index";

const SECRET = "brevo-inbound-test-secret-0123456789";

describe.skipIf(!connectionString)("Email intake: how far the Candidate's forwarding setup got (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let marie: string;
  let now: Date;
  let emailIntake: EmailIntake;
  let cipher: SecretCipher;
  let inbound: EmailIntakeInbound;

  /** Delivers emails as Brevo's inbound webhook does, at `at`. */
  async function deliver(at: string, ...items: BrevoInboundItem[]): Promise<void> {
    now = new Date(at);
    const response = await inbound.handle(
      new Request("http://localhost:3000/api/email-intake/inbound", {
        method: "POST",
        headers: { "content-type": "application/json", "x-inbound-secret": SECRET },
        body: JSON.stringify(inboundPayload(...items)),
      }),
    );
    expect(response.status).toBe(200);
  }

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateEmailIntake(database);
    const cookie = await signInWithMagicLink(testAuth, "marie.dupont@example.fr");
    marie = (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id;
    now = new Date("2026-10-27T09:30:00Z");
    emailIntake = createEmailIntake(database, { domain: () => "alertes.jobbbox.test", now: () => now });
    cipher = createAesGcmCipher(new Map([[1, createSecretKey(randomBytes(32))]]));
    inbound = createEmailIntakeInbound(database, {
      emailIntake,
      switchedOn: async () => true,
      cipher: () => cipher,
      queue: { send: async () => {} },
      settings: () => ({ secret: SECRET, brevoIpRanges: [], dailyCap: 30 }),
      now: () => now,
    });
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  it("is null while Email intake is off", async () => {
    expect(await forwardingSetupOf(database, cipher, marie)).toBeNull();
  });

  it("has the Forwarding address and nothing received yet, right after switching on", async () => {
    const { address } = await emailIntake.switchOn(marie);

    expect(await forwardingSetupOf(database, cipher, marie)).toEqual({
      address,
      activatedAt: new Date("2026-10-27T09:30:00Z"),
      confirmation: null,
      firstEmail: null,
    });
  });

  it("shows the code and link of Gmail's forwarding confirmation, which is not the first email", async () => {
    const { address } = await emailIntake.switchOn(marie);
    await deliver("2026-10-27T09:35:00Z", gmailForwardingConfirmation(address, { code: "424242" }));

    const setup = await forwardingSetupOf(database, cipher, marie);

    expect(setup?.confirmation).toEqual({
      code: "424242",
      link: "https://mail-settings.google.com/mail/vf-%5BANGjdJ-fixture-424242%5D-fixture",
      receivedAt: new Date("2026-10-27T09:35:00Z"),
    });
    expect(setup?.firstEmail).toBeNull();
  });

  it("shows the latest confirmation when Gmail sent several", async () => {
    const { address } = await emailIntake.switchOn(marie);
    await deliver("2026-10-27T09:35:00Z", gmailForwardingConfirmation(address, { code: "111111" }));
    await deliver("2026-10-27T09:40:00Z", gmailForwardingConfirmation(address, { code: "222222" }));

    expect((await forwardingSetupOf(database, cipher, marie))?.confirmation?.code).toBe("222222");
  });

  it("records the first email that reached the address, whatever became of it: the forwarding works", async () => {
    const { address } = await emailIntake.switchOn(marie);
    await deliver("2026-10-27T10:00:00Z", unknownSenderEmail(address));
    await deliver("2026-10-27T11:00:00Z", alertEmail(address));

    expect((await forwardingSetupOf(database, cipher, marie))?.firstEmail).toEqual({
      outcome: "unrecognised_sender",
      receivedAt: new Date("2026-10-27T10:00:00Z"),
    });
  });

  it("starts over with a new address: what reached the old one does not count", async () => {
    const { address: old } = await emailIntake.switchOn(marie);
    await deliver("2026-10-27T09:35:00Z", gmailForwardingConfirmation(old), alertEmail(old));
    now = new Date("2026-10-27T12:00:00Z");
    const replaced = await emailIntake.replace(marie);

    expect(await forwardingSetupOf(database, cipher, marie)).toEqual({ address: replaced!.address, activatedAt: replaced!.activatedAt, confirmation: null, firstEmail: null });
  });

  it("still says a confirmation arrived when its text cannot be read (no master key, or purged)", async () => {
    const { address } = await emailIntake.switchOn(marie);
    await deliver("2026-10-27T09:35:00Z", gmailForwardingConfirmation(address));

    expect((await forwardingSetupOf(database, null, marie))?.confirmation).toEqual({ code: null, link: null, receivedAt: new Date("2026-10-27T09:35:00Z") });
  });
});
