import type { MasterCvContent } from "@jobhub/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApplications, migrateApplications, type Applications } from "../applications";
import type { Mailer, MailMessage } from "../auth";
import { BrevoApiError } from "../auth/mailers";
import { connectionString, startTestBilling, type TestBilling } from "../billing/test-support";
import { createJobOffers, migrateJobOffers, type JobOffers } from "../job-offers";
import { createProfiles, migrateProfiles, type Profiles } from "../profiles";
import { createSends, migrateSends, type SendRequest, type Sends } from "./index";

const masterCv: MasterCvContent = {
  fullName: "Nathalie Exemple",
  headline: "Consultante achats",
  email: "nathalie.exemple@example.fr",
  phone: "",
  location: "Paris",
  summary: "",
  experience: [],
  education: [],
  skills: [],
  languages: [],
};

/** A mailbox that keeps what it is asked to send; `then` makes each send wait for it, `fails` makes it throw. */
function mailbox() {
  const sent: MailMessage[] = [];
  let fails: Error | null = null;
  let gate: Promise<void> | null = null;
  const mailer: Mailer = {
    async send(message) {
      if (gate) await gate;
      if (fails) throw fails;
      sent.push(message);
      return { messageId: `<${sent.length}@brevo.test>` };
    },
  };
  return {
    mailer,
    sent,
    failWith: (error: Error | null) => void (fails = error),
    hold: () => {
      let release = () => {};
      gate = new Promise<void>((resolve) => (release = resolve));
      return () => {
        gate = null;
        release();
      };
    },
  };
}

describe.skipIf(!connectionString)("Sends: an email Jobbbox sends in the Candidate's name, on their click (needs Postgres: DATABASE_URL; ADR-0119, #1162)", () => {
  let t: TestBilling;
  let profiles: Profiles;
  let jobOffers: JobOffers;
  let applications: Applications;
  let box: ReturnType<typeof mailbox>;
  let cap: number;
  let clock: { now: Date };
  let sends: Sends;
  let nathalie: string;
  let paul: string;
  let applicationId: string;

  const request = (overrides: Partial<SendRequest> = {}): SendRequest => ({
    key: "card-1",
    applicationId,
    kind: "follow_up",
    to: { email: "claire@exemple-conseil.test", name: "Claire Martin" },
    subject: "Relance de ma candidature",
    text: "Bonjour Claire, je reviens vers vous au sujet de ma candidature. Nathalie",
    ...overrides,
  });

  beforeEach(async () => {
    t = await startTestBilling();
    await migrateProfiles(t.database);
    await migrateJobOffers(t.database);
    await migrateApplications(t.database);
    await migrateSends(t.database);
    await migrateSends(t.database); // safe to run twice
    profiles = createProfiles(t.database);
    jobOffers = createJobOffers(t.database);
    applications = createApplications(t.database, { jobOffers, profiles });
    box = mailbox();
    cap = 20;
    clock = { now: new Date("2026-11-27T10:00:00+01:00") };
    sends = createSends(t.database, { mailer: box.mailer, cap: () => cap, now: () => clock.now });
    nathalie = (await t.signUp("nathalie.exemple@example.fr")).id;
    paul = (await t.signUp("paul.exemple@example.fr")).id;
    await t.database.query(`UPDATE candidate SET given_name = 'Nathalie', family_name = 'Exemple' WHERE id = $1`, [nathalie]);
    const profile = await profiles.create(nathalie, { masterCv, searchCriteria: { targetRole: "Consultante achats", locations: ["Paris"] } });
    if (!profile.ok) throw new Error("fixture refused");
    const captured = await jobOffers.capture({ source: { url: "https://www.welcometothejungle.com/offre/1" }, title: "Consultante achats", content: "Mission de 9 mois.", employer: "Exemple Conseil", location: "Paris" });
    if (!captured.ok) throw new Error("fixture refused");
    const saved = await applications.save(nathalie, { jobOfferId: captured.jobOffer.id, profileId: profile.profile.id });
    if (!saved.ok) throw new Error("fixture refused");
    applicationId = saved.application.id;
  });

  afterEach(async () => {
    await t.stop();
  });

  it("sends from Jobbbox's own address in the Candidate's name, their sign-in email in copy and as Reply-To, and keeps it on the Application with its date", async () => {
    expect(await sends.sendingAs(nathalie)).toEqual({ name: "Nathalie Exemple via Jobbbox", copyTo: "nathalie.exemple@example.fr" });

    const result = await sends.send(nathalie, request());

    expect(box.sent).toEqual([
      {
        to: "claire@exemple-conseil.test",
        subject: "Relance de ma candidature",
        text: "Bonjour Claire, je reviens vers vous au sujet de ma candidature. Nathalie",
        fromName: "Nathalie Exemple via Jobbbox",
        cc: "nathalie.exemple@example.fr",
        replyTo: "nathalie.exemple@example.fr",
      },
    ]);
    const sent = { id: expect.any(String), applicationId, kind: "follow_up", to: { email: "claire@exemple-conseil.test", name: "Claire Martin" }, subject: "Relance de ma candidature", sentAt: clock.now, key: "card-1" };
    expect(result).toEqual({ ok: true, sent });
    expect(await sends.onApplication(nathalie, applicationId)).toEqual([sent]);
    expect(await sends.onApplication(paul, applicationId)).toEqual([]);
  });

  it("sends once for one key: a second click, even while the first is still sending, sends nothing more", async () => {
    const release = box.hold();
    const first = sends.send(nathalie, request());
    const second = sends.send(nathalie, request());
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();

    const results = await Promise.all([first, second]);
    expect(box.sent).toHaveLength(1);
    expect(results.filter((each) => each.ok && !("already" in each))).toHaveLength(1);
    expect(results.filter((each) => each.ok && "already" in each)).toHaveLength(1);
    expect(await sends.send(nathalie, request())).toMatchObject({ ok: true, already: true });
    expect(box.sent).toHaveLength(1);
    expect(await sends.onApplication(nathalie, applicationId)).toHaveLength(1);
  });

  it("refuses past the daily cap, per Candidate, and counts again from the next day in Paris", async () => {
    cap = 2;
    expect(await sends.room(nathalie)).toEqual({ sentToday: 0, cap: 2 });
    await sends.send(nathalie, request({ key: "a" }));
    await sends.send(nathalie, request({ key: "b" }));

    expect(await sends.room(nathalie)).toEqual({ sentToday: 2, cap: 2 });
    expect(await sends.send(nathalie, request({ key: "c" }))).toEqual({ ok: false, error: "cap", room: { sentToday: 2, cap: 2 } });
    expect(box.sent).toHaveLength(2);

    clock.now = new Date("2026-11-28T00:05:00+01:00");
    expect(await sends.room(nathalie)).toEqual({ sentToday: 0, cap: 2 });
    expect(await sends.send(nathalie, request({ key: "c" }))).toMatchObject({ ok: true });
  });

  it("forgets a send Brevo refused, so the Candidate can click again; one whose fate is unknown is never sent again", async () => {
    box.failWith(new BrevoApiError(400, "invalid email"));
    expect(await sends.send(nathalie, request())).toEqual({ ok: false, error: "failed" });
    expect(await sends.room(nathalie)).toEqual({ sentToday: 0, cap: 20 });

    box.failWith(new Error("The operation was aborted due to timeout"));
    expect(await sends.send(nathalie, request())).toEqual({ ok: false, error: "uncertain" });
    box.failWith(null);
    expect(await sends.send(nathalie, request())).toEqual({ ok: false, error: "uncertain" });
    expect(box.sent).toEqual([]);
    // It may have gone: it counts toward the cap, and is not shown as sent.
    expect(await sends.room(nathalie)).toEqual({ sentToday: 1, cap: 20 });
    expect(await sends.onApplication(nathalie, applicationId)).toEqual([]);
  });

  it("sends only on the Candidate's own Application", async () => {
    expect(await sends.send(paul, request())).toEqual({ ok: false, error: "not_found" });
    expect(await sends.send(nathalie, request({ applicationId: "00000000-0000-4000-8000-000000000000" }))).toEqual({ ok: false, error: "not_found" });
    expect(box.sent).toEqual([]);
  });

  it("names the Candidate by their account's name without a Given Name, and keeps line breaks and quotes out of it", async () => {
    await t.database.query(`UPDATE candidate SET given_name = NULL, family_name = NULL, name = $2 WHERE id = $1`, [paul, 'Paul "X"\r\nBcc: a@b.c']);
    expect(await sends.sendingAs(paul)).toEqual({ name: "Paul X Bcc: a@b.c via Jobbbox", copyTo: "paul.exemple@example.fr" });
  });
});
