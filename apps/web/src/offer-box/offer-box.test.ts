import type { MasterCvContent } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApplications, migrateApplications, type Applications } from "../applications";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { migrateCoachConversations, sentByShareCapture } from "../coach-conversations";
import { migrateEmailIntake } from "../email-intake";
import { migrateEmailReadings } from "../email-intake/reading";
import { seedReceivedOfferEmail } from "../email-intake/test-support";
import { createJobOffers, migrateJobOffers, type JobOffers } from "../job-offers";
import { migrateJobDigests } from "../job-digests";
import { migrateJobSearches } from "../job-searches";
import { createProfiles, migrateProfiles, type Profiles } from "../profiles";
import { backfillOfferBox, createOfferBox, dismissedJobOffers, migrateOfferBox, offerBoxOf, offersToHandle, purgeExpiredOfferBoxEntries, recordArrivals, type OfferBox } from "./index";

const masterCv: MasterCvContent = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [{ title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2005 – 2024", description: "Consolidation IFRS." }],
  education: [],
  skills: ["IFRS", "SAP"],
  languages: [],
};

const DAY = 24 * 60 * 60 * 1000;

describe.skipIf(!connectionString)("The Offer box (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let profiles: Profiles;
  let jobOffers: JobOffers;
  let applications: Applications;
  let offerBox: OfferBox;
  let clock: { now: Date };
  let marie: string;
  let paul: string;
  let daf: string;
  let captured: number;

  async function signIn(email: string) {
    const cookie = await signInWithMagicLink(testAuth, email);
    return (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id as string;
  }

  async function createProfile(owner: string, targetRole = "DAF", locations = ["Lyon"]) {
    const created = await profiles.create(owner, { masterCv, searchCriteria: { targetRole, locations, contractTypes: ["cdi"] } });
    if (!created.ok) throw new Error("fixture Profile refused");
    return created.profile.id;
  }

  /** A Job Offer stored now: one that fits a DAF in Lyon (Match Score 100) unless `weak`; private to a Candidate with `privateTo`. */
  async function stored(title: string, options: { weak?: boolean; postedAt?: Date; privateTo?: string } = {}) {
    captured++;
    const details = options.weak ? { location: "Marseille", contractType: "cdd", skills: ["Excel"] } : { employer: "Acme Industrie", location: "Lyon", contractType: "cdi", skills: ["IFRS", "SAP"] };
    const result = await jobOffers.capture(
      { source: { url: `https://carrieres.example.fr/${captured}` }, title, content: `${title} (${captured}). Poste à pourvoir.`, ...details },
      "candidate",
      { ...(options.postedAt && { postedAt: options.postedAt }), ...(options.privateTo && { privateTo: options.privateTo }) },
    );
    if (!result.ok) throw new Error("fixture Job Offer refused");
    return result.jobOffer.id;
  }

  const entries = async (candidateId = marie) => (await offerBox.read(candidateId)).entries;

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateProfiles(database);
    await migrateJobOffers(database);
    await migrateApplications(database);
    await migrateOfferBox(database);
    await migrateOfferBox(database); // safe to run twice
    clock = { now: new Date("2026-11-05T10:00:00+01:00") };
    captured = 0;
    profiles = createProfiles(database);
    jobOffers = createJobOffers(database);
    applications = createApplications(database, { jobOffers, profiles });
    offerBox = createOfferBox(database, { profiles, jobOffers, now: () => clock.now });
    marie = await signIn("marie.dupont@example.fr");
    paul = await signIn("paul.martin@example.fr");
    daf = await createProfile(marie);
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  describe("an Arrival", () => {
    it("makes one Offer box entry per Job Offer, with its Profile, its source and its day in French time, à traiter", async () => {
      const offer = await stored("DAF H/F");
      // 00:30 in Paris on the 5th is still the 4th in UTC.
      await recordArrivals(database, { candidateId: marie, profileId: daf, source: "job_search", at: new Date("2026-11-04T23:30:00Z"), jobOfferIds: [offer] });

      const box = await offerBox.read(marie);
      expect(box.today).toBe("2026-11-05");
      expect(box.entries).toEqual([
        expect.objectContaining({
          jobOffer: expect.objectContaining({ id: offer, title: "DAF H/F" }),
          profile: { id: daf, name: "DAF" },
          scoredWith: { id: daf, name: "DAF" },
          firstArrivalAt: new Date("2026-11-04T23:30:00Z"),
          arrivalDay: "2026-11-05",
          sources: [{ source: "job_search", at: new Date("2026-11-04T23:30:00Z") }],
          state: "to_handle",
          applicationId: null,
          followedAt: null,
        }),
      ]);
      expect(box.entries[0]!.matchScore?.score).toBe(100);
      expect(box.toHandle).toBe(1);
    });

    it("of a Job Offer already there adds its source, keeping the entry's day and Profile; the same source again changes nothing", async () => {
      const offer = await stored("DAF H/F");
      const other = await createProfile(marie, "Contrôleuse de gestion");
      await recordArrivals(database, { candidateId: marie, profileId: daf, source: "job_search", at: new Date("2026-11-01T08:00:00Z"), jobOfferIds: [offer] });
      await recordArrivals(database, { candidateId: marie, profileId: other, source: "email", at: new Date("2026-11-05T08:00:00Z"), jobOfferIds: [offer] });
      await recordArrivals(database, { candidateId: marie, profileId: other, source: "job_search", at: new Date("2026-11-05T09:00:00Z"), jobOfferIds: [offer] });

      expect(await entries()).toEqual([
        expect.objectContaining({
          profile: { id: daf, name: "DAF" },
          arrivalDay: "2026-11-01",
          sources: [
            { source: "job_search", at: new Date("2026-11-01T08:00:00Z") },
            { source: "email", at: new Date("2026-11-05T08:00:00Z") },
          ],
        }),
      ]);
    });

    it("of a Job Offer private to a Candidate makes an entry only for them (ADR-0049)", async () => {
      const theirs = await stored("Poste confidentiel", { privateTo: marie });
      await recordArrivals(database, { candidateId: paul, profileId: null, source: "email", at: clock.now, jobOfferIds: [theirs] });
      await recordArrivals(database, { candidateId: marie, profileId: daf, source: "email", at: clock.now, jobOfferIds: [theirs] });

      expect(await entries(paul)).toEqual([]);
      expect((await entries(marie)).map((entry) => entry.jobOffer.id)).toEqual([theirs]);
    });

    it("without a Profile is « Non classée », scored against the active Profile it matches best", async () => {
      const offer = await stored("DAF H/F");
      const elsewhere = await createProfile(marie, "DAF", ["Marseille"]);
      await recordArrivals(database, { candidateId: marie, profileId: null, source: "email", at: clock.now, jobOfferIds: [offer] });

      const [entry] = await entries();
      expect(entry).toMatchObject({ profile: null, scoredWith: { id: daf, name: "DAF" } });
      expect(entry!.matchScore?.score).toBe(100);
      expect(elsewhere).not.toBe(daf);
    });
  });

  it("lists the most recent first Arrival first, and only the Candidate's own entries", async () => {
    const first = await stored("Premier");
    const second = await stored("Second");
    await recordArrivals(database, { candidateId: marie, profileId: daf, source: "job_digest", at: new Date(clock.now.getTime() - DAY), jobOfferIds: [first] });
    await recordArrivals(database, { candidateId: marie, profileId: daf, source: "job_offer_link", at: clock.now, jobOfferIds: [second] });

    expect((await entries()).map((entry) => entry.jobOffer.id)).toEqual([second, first]);
    expect(await entries(paul)).toEqual([]);
  });

  it("is « Suivie » while an Application of the Job Offer exists, whichever page made it, and à traiter again without it", async () => {
    const offer = await stored("DAF H/F");
    await recordArrivals(database, { candidateId: marie, profileId: daf, source: "job_search", at: clock.now, jobOfferIds: [offer] });
    const saved = await applications.save(marie, { jobOfferId: offer, profileId: daf });
    if (!saved.ok) throw new Error("not saved");

    expect(await offerBox.read(marie)).toMatchObject({ toHandle: 0, entries: [{ state: "followed", applicationId: saved.application.id, followedAt: saved.application.createdAt }] });

    await database.query("DELETE FROM application WHERE id = $1", [saved.application.id]);
    expect(await offerBox.read(marie)).toMatchObject({ toHandle: 1, entries: [{ state: "to_handle", applicationId: null }] });
  });

  describe("« Écarter » (#816)", () => {
    async function arrived(title: string, candidateId = marie, profileId: string | null = daf) {
      const offer = await stored(title);
      await recordArrivals(database, { candidateId, profileId, source: "job_search", at: clock.now, jobOfferIds: [offer] });
      const entry = (await entries(candidateId)).find((one) => one.jobOffer.id === offer)!;
      return { offer, entry: entry.id };
    }

    it("with a Dismissal reason makes the entry « Écartée », out of the count, with its reason and when", async () => {
      const { entry } = await arrived("DAF H/F");

      expect(await offerBox.dismiss(marie, entry, { reason: "salary" })).toEqual({ ok: true });

      expect(await offerBox.read(marie)).toMatchObject({ toHandle: 0, entries: [{ id: entry, state: "dismissed", dismissalReason: "salary", dismissedAt: clock.now }] });
      expect(await offerBoxOf(database, marie)).toMatchObject([{ state: "dismissed", dismissalReason: "salary", decidedAt: clock.now }]);
    });

    it("without a reason (« Écarter sans motif ») too, and refuses a reason outside the list", async () => {
      const { entry } = await arrived("DAF H/F");

      expect(await offerBox.dismiss(marie, entry, { reason: "trop loin" })).toEqual({ ok: false, error: "invalid_reason" });
      expect(await offerBox.dismiss(marie, entry, {})).toEqual({ ok: true });

      expect(await entries()).toMatchObject([{ state: "dismissed", dismissalReason: null }]);
    });

    it("« Revenir sur ce choix » makes it à traiter again, its reason forgotten", async () => {
      const { entry } = await arrived("DAF H/F");
      await offerBox.dismiss(marie, entry, { reason: "location" });

      expect(await offerBox.reconsider(marie, entry)).toEqual({ ok: true });

      expect(await offerBox.read(marie)).toMatchObject({ toHandle: 1, entries: [{ state: "to_handle", dismissalReason: null, dismissedAt: null }] });
    });

    it("refuses an entry « Suivie »: it is undone only by deleting its Application", async () => {
      const { offer, entry } = await arrived("DAF H/F");
      await applications.save(marie, { jobOfferId: offer, profileId: daf });

      expect(await offerBox.dismiss(marie, entry, { reason: "salary" })).toEqual({ ok: false, error: "followed" });
      expect(await entries()).toMatchObject([{ state: "followed" }]);
    });

    it("is replaced by an Application made later: once that Application is deleted the entry is à traiter, with no decision", async () => {
      const { offer, entry } = await arrived("DAF H/F");
      await offerBox.dismiss(marie, entry, { reason: "salary" });
      const saved = await applications.save(marie, { jobOfferId: offer, profileId: daf });
      if (!saved.ok) throw new Error("not saved");

      expect(await entries()).toMatchObject([{ state: "followed", dismissalReason: null, dismissedAt: null }]);
      expect((await database.query(dismissedJobOffers("$1"), [marie])).rows).toEqual([]);

      await database.query("DELETE FROM application WHERE id = $1", [saved.application.id]);

      expect(await offerBox.read(marie)).toMatchObject({ toHandle: 1, entries: [{ id: entry, state: "to_handle", applicationId: null, dismissalReason: null, dismissedAt: null }] });
      expect(await offerBoxOf(database, marie)).toMatchObject([{ state: "to_handle", decidedAt: null, dismissalReason: null }]);
      expect((await database.query(dismissedJobOffers("$1"), [marie])).rows).toEqual([]);
    });

    it("touches only the Candidate's own entry: another Candidate's is not found, and their entry of the same Job Offer stays à traiter", async () => {
      const offer = await stored("Partagée");
      const paulsProfile = await createProfile(paul);
      await recordArrivals(database, { candidateId: marie, profileId: daf, source: "job_search", at: clock.now, jobOfferIds: [offer] });
      await recordArrivals(database, { candidateId: paul, profileId: paulsProfile, source: "job_search", at: clock.now, jobOfferIds: [offer] });
      const [maries] = await entries(marie);
      const [pauls] = await entries(paul);

      expect(await offerBox.dismiss(paul, maries!.id, {})).toEqual({ ok: false, error: "not_found" });
      expect(await offerBox.reconsider(paul, maries!.id)).toEqual({ ok: false, error: "not_found" });
      await offerBox.dismiss(marie, maries!.id, { reason: "not_for_me" });

      expect(await entries(paul)).toMatchObject([{ id: pauls!.id, state: "to_handle" }]);
      expect(await jobOffers.get(offer, paul)).toMatchObject({ id: offer });
    });

    it("stays « Écartée » when the Job Offer arrives again, from another source", async () => {
      const { offer, entry } = await arrived("DAF H/F");
      await offerBox.dismiss(marie, entry, {});
      await recordArrivals(database, { candidateId: marie, profileId: daf, source: "job_digest", at: clock.now, jobOfferIds: [offer] });

      expect(await entries()).toMatchObject([{ state: "dismissed", sources: [{ source: "job_digest" }, { source: "job_search" }] }]);
    });

    it("is read for « Écartées » 30 days after it was écartée, no longer after", async () => {
      const { entry: old } = await arrived("Écartée il y a 31 jours");
      const { entry: recent } = await arrived("Écartée il y a 29 jours");
      const today = clock.now;
      clock.now = new Date(today.getTime() - 31 * DAY);
      await offerBox.dismiss(marie, old, {});
      clock.now = new Date(today.getTime() - 29 * DAY);
      await offerBox.dismiss(marie, recent, {});
      clock.now = today;

      expect((await entries()).map((one) => one.id)).toEqual([recent]);
    });

    it("is still read as its Job Offer's entry 31 days after it was écartée, with its reason, and can be brought back (#895)", async () => {
      const { offer: withReason, entry: old } = await arrived("Écartée il y a 31 jours");
      const { offer: withoutReason, entry: bare } = await arrived("Écartée sans motif il y a 31 jours");
      const today = clock.now;
      clock.now = new Date(today.getTime() - 31 * DAY);
      await offerBox.dismiss(marie, old, { reason: "location" });
      await offerBox.dismiss(marie, bare, {});
      clock.now = today;

      expect(await entries()).toEqual([]);
      expect(await offerBox.entryOf(marie, withReason)).toMatchObject({ id: old, state: "dismissed", dismissalReason: "location", dismissedAt: new Date(today.getTime() - 31 * DAY) });
      expect(await offerBox.entryOf(marie, withoutReason)).toMatchObject({ id: bare, state: "dismissed", dismissalReason: null });

      expect(await offerBox.reconsider(marie, old)).toEqual({ ok: true });
      expect(await offerBox.entryOf(marie, withReason)).toMatchObject({ id: old, state: "to_handle", dismissalReason: null, dismissedAt: null });
      expect((await entries()).map((one) => one.id)).toEqual([old]);
    });

    it("gives a Job Offer's entry to its Candidate only, and none for a Job Offer that never reached them", async () => {
      const { offer, entry } = await arrived("DAF H/F");
      const elsewhere = await stored("Jamais arrivée");

      expect(await offerBox.entryOf(marie, offer)).toMatchObject({ id: entry, state: "to_handle" });
      expect(await offerBox.entryOf(paul, offer)).toBeNull();
      expect(await offerBox.entryOf(marie, elsewhere)).toBeNull();
      expect(await offerBox.entryOf(marie, "missing")).toBeNull();
    });

    it("lists the Job Offers the Candidate écarta, for the doors that must not bring them again", async () => {
      const { offer, entry } = await arrived("DAF H/F");
      const { offer: kept } = await arrived("Gardée");
      await offerBox.dismiss(marie, entry, {});

      const { rows } = await database.query<{ job_offer_id: string }>(dismissedJobOffers("$1"), [marie]);
      expect(rows.map((row) => row.job_offer_id)).toEqual([offer]);
      expect(rows.map((row) => row.job_offer_id)).not.toContain(kept);
      expect((await database.query(dismissedJobOffers("$1"), [paul])).rows).toEqual([]);
    });
  });

  describe("« Plus tard » (#817)", () => {
    async function arrived(title: string, at = clock.now) {
      const offer = await stored(title);
      await recordArrivals(database, { candidateId: marie, profileId: daf, source: "job_search", at, jobOfferIds: [offer] });
      return { offer, entry: (await entries()).find((one) => one.jobOffer.id === offer)!.id };
    }

    it("puts the entry out of sight until the next Monday 00:00 Paris time, still à traiter and in the count", async () => {
      const { entry } = await arrived("DAF H/F");

      // Thursday 5 November: back on Monday 9 November, 00:00 in Paris.
      expect(await offerBox.later(marie, entry)).toEqual({ ok: true, laterUntil: new Date("2026-11-08T23:00:00Z") });

      expect(await offerBox.read(marie)).toMatchObject({ toHandle: 1, entries: [{ id: entry, state: "later", laterUntil: new Date("2026-11-08T23:00:00Z") }] });
      expect(await offerBoxOf(database, marie)).toMatchObject([{ state: "later", decidedAt: null, laterUntil: new Date("2026-11-08T23:00:00Z") }]);
    });

    it("comes back à traiter that Monday at 00:00 Paris time, saying when it came back", async () => {
      const { entry } = await arrived("DAF H/F");
      await offerBox.later(marie, entry);

      clock.now = new Date("2026-11-08T23:59:59+01:00");
      expect(await entries()).toMatchObject([{ state: "later" }]);
      clock.now = new Date("2026-11-09T00:00:00+01:00");
      expect(await offerBox.read(marie)).toMatchObject({ today: "2026-11-09", toHandle: 1, entries: [{ state: "to_handle", laterUntil: new Date("2026-11-08T23:00:00Z") }] });
    });

    it("« Annuler » brings it back at once", async () => {
      const { entry } = await arrived("DAF H/F");
      await offerBox.later(marie, entry);

      expect(await offerBox.cancelLater(marie, entry)).toEqual({ ok: true });

      expect(await entries()).toMatchObject([{ state: "to_handle", laterUntil: null }]);
    });

    it("refuses an entry « Suivie » or « Écartée », and another Candidate's", async () => {
      const { offer, entry: followed } = await arrived("Suivie");
      await applications.save(marie, { jobOfferId: offer, profileId: daf });
      const { entry: dismissed } = await arrived("Écartée");
      await offerBox.dismiss(marie, dismissed, {});

      expect(await offerBox.later(marie, followed)).toEqual({ ok: false, error: "followed" });
      expect(await offerBox.later(marie, dismissed)).toEqual({ ok: false, error: "dismissed" });
      expect(await offerBox.later(paul, dismissed)).toEqual({ ok: false, error: "not_found" });
      expect(await offerBox.cancelLater(paul, dismissed)).toEqual({ ok: false, error: "not_found" });
      expect((await entries()).map((one) => one.state).sort()).toEqual(["dismissed", "followed"]);
    });

    it("is undone by « Écarter », which can still be chosen", async () => {
      const { entry } = await arrived("DAF H/F");
      await offerBox.later(marie, entry);

      expect(await offerBox.dismiss(marie, entry, { reason: "location" })).toEqual({ ok: true });
      expect(await entries()).toMatchObject([{ state: "dismissed", laterUntil: null }]);
    });

    it("écartée once back on its Monday, then « Annuler »: back exactly where it was, under « Aujourd'hui » that Monday, its date kept", async () => {
      const { entry } = await arrived("DAF H/F", new Date("2026-11-04T09:00:00+01:00"));
      await offerBox.later(marie, entry);
      clock.now = new Date("2026-11-09T10:00:00+01:00");
      const back = await offerBox.read(marie);
      expect(back).toMatchObject({ toHandle: 1, entries: [{ id: entry, state: "to_handle", arrivalDay: "2026-11-04", laterUntil: new Date("2026-11-08T23:00:00Z") }] });

      await offerBox.dismiss(marie, entry, { reason: "salary" });
      expect(await offerBox.read(marie)).toMatchObject({ toHandle: 0, entries: [{ id: entry, state: "dismissed", laterUntil: null }] });

      expect(await offerBox.reconsider(marie, entry)).toEqual({ ok: true });
      expect(await offerBox.read(marie)).toEqual(back);
      expect(await offerBoxOf(database, marie)).toMatchObject([{ state: "later", decidedAt: null, dismissalReason: null, laterUntil: new Date("2026-11-08T23:00:00Z") }]);
    });

    it("écartée while away, then « Annuler »: still « Plus tard » until the same Monday", async () => {
      const { entry } = await arrived("DAF H/F");
      await offerBox.later(marie, entry);
      const away = await offerBox.read(marie);

      await offerBox.dismiss(marie, entry, {});
      expect(await offerBox.read(marie)).toMatchObject({ toHandle: 0, entries: [{ state: "dismissed", laterUntil: null }] });
      await offerBox.reconsider(marie, entry);

      expect(await offerBox.read(marie)).toEqual(away);
      expect(away).toMatchObject({ toHandle: 1, entries: [{ state: "later", laterUntil: new Date("2026-11-08T23:00:00Z") }] });
    });

    it("écartée by « Tout écarter » once back on its Monday, then « Annuler »: back exactly where it was, the others too", async () => {
      const [back, other] = [await stored("Revenue lundi"), await stored("Jamais mise de côté")];
      await recordArrivals(database, { candidateId: marie, profileId: daf, source: "job_search", at: new Date("2026-11-03T09:00:00+01:00"), jobOfferIds: [back, other] });
      const id = async (offer: string) => (await entries()).find((one) => one.jobOffer.id === offer)!.id;
      await offerBox.later(marie, await id(back));
      clock.now = new Date("2026-11-09T10:00:00+01:00");
      const before = await offerBox.read(marie);
      expect(Object.fromEntries(before.entries.map((one) => [one.jobOffer.title, [one.state, one.laterUntil]]))).toEqual({
        "Revenue lundi": ["to_handle", new Date("2026-11-08T23:00:00Z")],
        "Jamais mise de côté": ["to_handle", null],
      });

      const { dismissed } = await offerBox.dismissAll(marie, before.entries.map((one) => one.id));
      expect(dismissed).toHaveLength(2);
      expect(await offerBox.read(marie)).toMatchObject({ toHandle: 0, entries: [{ state: "dismissed", laterUntil: null }, { state: "dismissed", laterUntil: null }] });

      await offerBox.reconsiderAll(marie, dismissed);
      expect(await offerBox.read(marie)).toEqual(before);
    });

    it("écartée, then replaced by an Application deleted later: back « Plus tard » until its Monday", async () => {
      const { offer, entry } = await arrived("DAF H/F");
      await offerBox.later(marie, entry);
      await offerBox.dismiss(marie, entry, {});
      const saved = await applications.save(marie, { jobOfferId: offer, profileId: daf });
      if (!saved.ok) throw new Error("not saved");
      await database.query("DELETE FROM application WHERE id = $1", [saved.application.id]);

      expect(await offerBox.read(marie)).toMatchObject({ toHandle: 1, entries: [{ state: "later", laterUntil: new Date("2026-11-08T23:00:00Z"), dismissalReason: null, dismissedAt: null }] });
    });
  });

  describe("« Expirées sans décision » (#817)", () => {
    it("is an entry still à traiter whose Posting date passed 30 days: out of the count, never écartée for the Candidate", async () => {
      const thirty = await stored("Publiée il y a 30 jours", { postedAt: new Date(clock.now.getTime() - 30 * DAY) });
      const thirtyOne = await stored("Publiée il y a 31 jours", { postedAt: new Date(clock.now.getTime() - 31 * DAY) });
      await recordArrivals(database, { candidateId: marie, profileId: daf, source: "job_search", at: new Date(clock.now.getTime() - 2 * DAY), jobOfferIds: [thirty, thirtyOne] });

      const box = await offerBox.read(marie);
      expect(box.toHandle).toBe(1);
      expect(Object.fromEntries(box.entries.map((one) => [one.jobOffer.title, one.state]))).toEqual({ "Publiée il y a 30 jours": "to_handle", "Publiée il y a 31 jours": "expired" });
      expect((await database.query(dismissedJobOffers("$1"), [marie])).rows).toEqual([]);

      clock.now = new Date(clock.now.getTime() + DAY);
      expect(await offerBox.read(marie)).toMatchObject({ toHandle: 0 });
    });

    it("without a Posting date, counts the 30 days from the first Arrival", async () => {
      const recent = await stored("Arrivée il y a 30 jours");
      const old = await stored("Arrivée il y a 31 jours");
      await recordArrivals(database, { candidateId: marie, profileId: daf, source: "email", at: new Date(clock.now.getTime() - 30 * DAY), jobOfferIds: [recent] });
      await recordArrivals(database, { candidateId: marie, profileId: daf, source: "email", at: new Date(clock.now.getTime() - 31 * DAY), jobOfferIds: [old] });

      expect(Object.fromEntries((await entries()).map((one) => [one.jobOffer.title, one.state]))).toEqual({ "Arrivée il y a 30 jours": "to_handle", "Arrivée il y a 31 jours": "expired" });
    });

    it("takes « Plus tard » with it, and can still be écartée; one « Suivie » or « Écartée » stays so", async () => {
      const posted = { postedAt: new Date(clock.now.getTime() - 40 * DAY) };
      const [later, kept, dismissed] = [await stored("Plus tard", posted), await stored("Suivie", posted), await stored("Écartée", posted)];
      await recordArrivals(database, { candidateId: marie, profileId: daf, source: "job_search", at: clock.now, jobOfferIds: [later, kept, dismissed] });
      const id = async (offer: string) => (await entries()).find((one) => one.jobOffer.id === offer)!.id;
      await offerBox.later(marie, await id(later));
      await applications.save(marie, { jobOfferId: kept, profileId: daf });
      await offerBox.dismiss(marie, await id(dismissed), {});

      expect(Object.fromEntries((await entries()).map((one) => [one.jobOffer.title, one.state]))).toEqual({ "Plus tard": "expired", Suivie: "followed", "Écartée": "dismissed" });
      expect(await offerBox.dismiss(marie, await id(later), { reason: "not_for_me" })).toEqual({ ok: true });
      expect((await entries()).find((one) => one.jobOffer.id === later)).toMatchObject({ state: "dismissed", dismissalReason: "not_for_me" });
    });
  });

  describe("« Tout écarter (n) » (#817)", () => {
    it("écarte the Candidate's entries it names, without a reason, and says which; « Annuler » makes exactly those à traiter again", async () => {
      const [a, b, followed, before] = [await stored("A"), await stored("B"), await stored("Suivie"), await stored("Écartée avant")];
      await recordArrivals(database, { candidateId: marie, profileId: daf, source: "job_search", at: new Date(clock.now.getTime() - 2 * DAY), jobOfferIds: [a, b, followed, before] });
      const id = async (offer: string) => (await entries()).find((one) => one.jobOffer.id === offer)!.id;
      await applications.save(marie, { jobOfferId: followed, profileId: daf });
      await offerBox.dismiss(marie, await id(before), { reason: "salary" });
      const named = [await id(a), await id(b), await id(followed), await id(before)];

      const { dismissed } = await offerBox.dismissAll(marie, [...named, "not-a-uuid"]);

      expect(dismissed.sort()).toEqual([named[0], named[1]].sort());
      expect(Object.fromEntries((await entries()).map((one) => [one.jobOffer.title, [one.state, one.dismissalReason]]))).toEqual({
        A: ["dismissed", null],
        B: ["dismissed", null],
        Suivie: ["followed", null],
        "Écartée avant": ["dismissed", "salary"],
      });

      await offerBox.reconsiderAll(marie, dismissed);

      expect(Object.fromEntries((await entries()).map((one) => [one.jobOffer.title, one.state]))).toEqual({ A: "to_handle", B: "to_handle", Suivie: "followed", "Écartée avant": "dismissed" });
    });

    it("touches no other Candidate's entry", async () => {
      const offer = await stored("Partagée");
      await recordArrivals(database, { candidateId: paul, profileId: null, source: "job_search", at: clock.now, jobOfferIds: [offer] });
      const [pauls] = await entries(paul);

      expect(await offerBox.dismissAll(marie, [pauls!.id])).toEqual({ dismissed: [] });
      expect(await entries(paul)).toMatchObject([{ state: "to_handle" }]);
    });
  });

  it("is deleted with its Profile and with the account; a « Non classée » one with the account", async () => {
    const offer = await stored("DAF H/F");
    const unsorted = await stored("Hors profil", { weak: true });
    await recordArrivals(database, { candidateId: marie, profileId: daf, source: "job_search", at: clock.now, jobOfferIds: [offer] });
    await recordArrivals(database, { candidateId: marie, profileId: null, source: "email", at: clock.now, jobOfferIds: [unsorted] });

    await database.query("DELETE FROM profile WHERE id = $1", [daf]);
    expect((await offerBoxOf(database, marie)).map((entry) => entry.jobOfferId)).toEqual([unsorted]);

    await database.query("DELETE FROM candidate WHERE id = $1", [marie]);
    const { rows } = await database.query("SELECT count(*)::int AS left FROM offer_box_entry");
    expect(rows[0].left).toBe(0);
  });

  it("is purged 12 months after its first Arrival", async () => {
    const old = await stored("Ancienne");
    const recent = await stored("Récente");
    await recordArrivals(database, { candidateId: marie, profileId: daf, source: "job_search", at: new Date("2025-11-04T10:00:00Z"), jobOfferIds: [old] });
    await recordArrivals(database, { candidateId: marie, profileId: daf, source: "job_search", at: new Date("2025-11-06T10:00:00Z"), jobOfferIds: [recent] });

    expect(await purgeExpiredOfferBoxEntries(database, clock.now)).toBe(1);
    expect((await offerBoxOf(database, marie)).map((entry) => entry.jobOfferId)).toEqual([recent]);
  });

  it("is in the Data export: its Job Offer, Profile, first Arrival, Arrival sources with their dates, and where it stands", async () => {
    const offer = await stored("DAF H/F");
    await recordArrivals(database, { candidateId: marie, profileId: daf, source: "job_digest", at: new Date("2026-11-05T06:00:00Z"), jobOfferIds: [offer] });
    await applications.save(marie, { jobOfferId: offer, profileId: daf });

    expect(await offerBoxOf(database, marie)).toEqual([
      {
        jobOfferId: offer,
        profileId: daf,
        firstArrivalAt: new Date("2026-11-05T06:00:00Z"),
        arrivalSources: [{ source: "job_digest", at: new Date("2026-11-05T06:00:00Z") }],
        state: "followed",
        decidedAt: null,
        dismissalReason: null,
        laterUntil: null,
      },
    ]);
    expect(await offerBoxOf(database, paul)).toEqual([]);
  });

  describe("the count of offers à traiter (#818): the Sidebar's, the app's badge and the Job Digest's line", () => {
    async function arrived(title: string, options: { postedAt?: Date; at?: Date; candidateId?: string } = {}) {
      const offer = await stored(title, options.postedAt ? { postedAt: options.postedAt } : {});
      const candidateId = options.candidateId ?? marie;
      await recordArrivals(database, { candidateId, profileId: candidateId === marie ? daf : null, source: "job_digest", at: options.at ?? clock.now, jobOfferIds: [offer] });
      const { rows } = await database.query<{ id: string }>(`SELECT id FROM offer_box_entry WHERE job_offer_id = $1`, [offer]);
      return { offer, entry: rows[0]!.id };
    }

    it("counts each entry à traiter, the Candidate's only; none is 0", async () => {
      expect(await offersToHandle(database, marie, clock.now)).toBe(0);
      await arrived("DAF H/F");
      await arrived("DAF adjoint H/F");
      await arrived("DAF de Paul", { candidateId: paul });

      expect(await offersToHandle(database, marie, clock.now)).toBe(2);
      expect(await offerBox.toHandle(marie)).toBe(2);
      expect(await offersToHandle(database, paul, clock.now)).toBe(1);
    });

    it("counts « Plus tard »: it is not a decision", async () => {
      const { entry } = await arrived("DAF H/F");
      await database.query(`UPDATE offer_box_entry SET state = 'later', later_until = $2 WHERE id = $1`, [entry, new Date("2026-11-09T00:00:00+01:00")]);

      expect(await offersToHandle(database, marie, clock.now)).toBe(1);
    });

    it("leaves out « Suivie » and « Écartée »; « Revenir sur ce choix » and a deleted Application count it again", async () => {
      const { offer: followed } = await arrived("DAF H/F");
      const { entry: dismissed } = await arrived("DAF adjoint H/F");
      const saved = await applications.save(marie, { jobOfferId: followed, profileId: daf });
      if (!saved.ok) throw new Error("fixture Application refused");
      await offerBox.dismiss(marie, dismissed, { reason: "salary" });

      expect(await offersToHandle(database, marie, clock.now)).toBe(0);

      await offerBox.reconsider(marie, dismissed);
      await database.query("DELETE FROM application WHERE id = $1", [saved.application.id]);
      expect(await offersToHandle(database, marie, clock.now)).toBe(2);
    });

    it("leaves out « Expirée sans décision »: posted more than 30 French days ago, or arrived so when the Posting date is unknown", async () => {
      // On the 5th of November in Paris, the 6th of October is 30 days before: still counted; the 5th, 31: expired.
      await arrived("Publiée il y a 30 jours", { postedAt: new Date("2026-10-06T00:30:00+02:00") });
      await arrived("Publiée il y a 31 jours", { postedAt: new Date("2026-10-05T23:30:00+02:00") });
      await arrived("Sans date, arrivée il y a 31 jours", { at: new Date("2026-10-05T12:00:00+02:00") });
      await arrived("Sans date, arrivée il y a 30 jours", { at: new Date("2026-10-06T12:00:00+02:00") });

      expect(await offersToHandle(database, marie, clock.now)).toBe(2);
      // A day later, the two left expire too.
      expect(await offersToHandle(database, marie, new Date("2026-11-06T10:00:00+01:00"))).toBe(0);
    });
  });

  describe("a Capture or a Share capture, once followed (#819)", () => {
    let following: Applications;

    beforeEach(async () => {
      await migrateJobSearches(database);
      await migrateJobDigests(database);
      await migrateCoachConversations(database);
      following = createApplications(database, { jobOffers, profiles, sentByShareCapture: (candidateId, jobOfferId) => sentByShareCapture(database, candidateId, jobOfferId) });
    });

    /** What a Share capture leaves (#697): its conversation's set reply, with the Job Offer card, marked as the share's. */
    async function shared(jobOfferId: string, candidateId = marie, at = clock.now) {
      const conversation = await database.query<{ id: string }>(
        `INSERT INTO coach_conversation (candidate_id, title, created_at, last_message_at) VALUES ($1, 'Partagée', $2, $2) RETURNING id`,
        [candidateId, at],
      );
      await database.query(`INSERT INTO coach_message (conversation_id, author, text, created_at, job_offer_id, share_capture) VALUES ($1, 'coach', 'J''ai lu cette offre.', $2, $3, true)`, [
        conversation.rows[0]!.id,
        at,
        jobOfferId,
      ]);
    }

    const rowsOf = async (candidateId = marie) => (await database.query(`SELECT 1 FROM offer_box_entry WHERE candidate_id = $1`, [candidateId])).rowCount;

    it("a Capture followed from the extension's Side Panel makes its entry, already « Suivie », with the source « Extension » and the Application's Profile", async () => {
      const captured = await stored("Capturée sur LinkedIn");
      const saved = await following.save(marie, { jobOfferId: captured, profileId: daf }, { extension: { candidateId: marie, extensionVersion: null } });
      if (!saved.ok) throw new Error("not saved");

      const box = await offerBox.read(marie);
      expect(box).toMatchObject({ toHandle: 0 });
      expect(box.entries).toEqual([
        expect.objectContaining({
          jobOffer: expect.objectContaining({ id: captured }),
          profile: { id: daf, name: "DAF" },
          firstArrivalAt: saved.application.createdAt,
          sources: [{ source: "extension", at: saved.application.createdAt }],
          state: "followed",
          applicationId: saved.application.id,
        }),
      ]);
    });

    it("a Capture followed of a Job Offer already in the box adds « Extension » to its entry, which keeps its day and Profile", async () => {
      const offer = await stored("Trouvée puis capturée");
      const other = await createProfile(marie, "Contrôleuse de gestion");
      const twoDaysAgo = new Date(Date.now() - 2 * DAY);
      await recordArrivals(database, { candidateId: marie, profileId: daf, source: "job_search", at: twoDaysAgo, jobOfferIds: [offer] });
      const saved = await following.save(marie, { jobOfferId: offer, profileId: other }, { extension: { candidateId: marie, extensionVersion: null } });
      if (!saved.ok) throw new Error("not saved");

      expect(await entries()).toEqual([
        expect.objectContaining({
          profile: { id: daf, name: "DAF" },
          firstArrivalAt: twoDaysAgo,
          sources: [
            { source: "job_search", at: twoDaysAgo },
            { source: "extension", at: saved.application.createdAt },
          ],
          state: "followed",
        }),
      ]);
    });

    it("a Capture followed of a Job Offer saved long ago, then found by a Job Search, adds « Extension » now: its entry keeps its day and Profile", async () => {
      const offer = await stored("Enregistrée il y a longtemps, retrouvée puis capturée");
      const other = await createProfile(marie, "Contrôleuse de gestion");
      const first = await following.save(marie, { jobOfferId: offer, profileId: other });
      if (!first.ok) throw new Error("not saved");
      await database.query(`UPDATE application SET created_at = $2 WHERE id = $1`, [first.application.id, new Date(Date.now() - 10 * DAY)]);
      const twoDaysAgo = new Date(Date.now() - 2 * DAY);
      await recordArrivals(database, { candidateId: marie, profileId: daf, source: "job_search", at: twoDaysAgo, jobOfferIds: [offer] });
      const before = new Date();

      const again = await following.save(marie, { jobOfferId: offer, profileId: other }, { extension: { candidateId: marie, extensionVersion: null } });
      if (!again.ok) throw new Error("not saved");

      const [entry] = await entries();
      expect(entry).toMatchObject({ profile: { id: daf, name: "DAF" }, firstArrivalAt: twoDaysAgo, state: "followed" });
      const extension = entry!.sources.find((arrival) => arrival.source === "extension");
      expect(extension!.at.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });

    it("a Capture not followed records nothing: no entry, no row", async () => {
      await stored("Capturée, pas suivie");

      expect(await entries()).toEqual([]);
      expect(await rowsOf()).toBe(0);
    });

    it("a Job Offer saved elsewhere than the Side Panel, and never shared, makes no entry", async () => {
      const offer = await stored("Enregistrée depuis sa page");
      await following.save(marie, { jobOfferId: offer, profileId: daf });

      expect(await rowsOf()).toBe(0);
    });

    it("a Share capture followed, wherever (a Job Offer card's « Enregistrer », a Coach Action), makes its entry « Suivie » with the source « Partage »", async () => {
      const offer = await stored("Partagée depuis l'app", { privateTo: marie });
      await shared(offer);

      expect(await rowsOf()).toBe(0); // shared, not followed: nothing yet (ADR-0090)

      const saved = await following.save(marie, { jobOfferId: offer, profileId: daf });
      if (!saved.ok) throw new Error("not saved");
      expect(await entries()).toEqual([
        expect.objectContaining({
          jobOffer: expect.objectContaining({ id: offer }),
          profile: { id: daf, name: "DAF" },
          sources: [{ source: "share", at: saved.application.createdAt }],
          state: "followed",
          applicationId: saved.application.id,
        }),
      ]);
    });

    it("another Candidate's Share capture of the same Job Offer gives « Partage » to no one else", async () => {
      const offer = await stored("Partagée par Marie");
      await shared(offer, marie);
      const pauls = await createProfile(paul);

      await following.save(paul, { jobOfferId: offer, profileId: pauls });
      expect(await rowsOf(paul)).toBe(0);
    });

    it("saved again, it moves nothing: its source keeps the date it first came by", async () => {
      const captured = await stored("Capturée deux fois");
      const first = await following.save(marie, { jobOfferId: captured, profileId: daf }, { extension: { candidateId: marie, extensionVersion: null } });
      if (!first.ok) throw new Error("not saved");
      await following.save(marie, { jobOfferId: captured, profileId: daf }, { extension: { candidateId: marie, extensionVersion: null } });

      expect(await entries()).toEqual([expect.objectContaining({ sources: [{ source: "extension", at: first.application.createdAt }], state: "followed" })]);
    });
  });

  describe("at launch, filled from the last 30 days", () => {
    beforeEach(async () => {
      await migrateJobSearches(database);
      await migrateJobDigests(database);
      await migrateEmailIntake(database);
      await migrateEmailReadings(database);
      await migrateCoachConversations(database);
    });

    it("takes the Job Offers of Job Searches, Job Digests, Received offer emails and Job Offer cards, each with its source, once", async () => {
      const searched = await stored("Trouvée par une recherche");
      const digested = await stored("Dans un Job Digest");
      const emailed = await stored("Reçue par email");
      const linked = await stored("Collée au coach");
      const twice = await stored("Recherche puis email");
      const tenDaysAgo = new Date(clock.now.getTime() - 10 * DAY);
      const fiveDaysAgo = new Date(clock.now.getTime() - 5 * DAY);
      await database.query(
        `INSERT INTO job_search (candidate_id, profile_id, status, job_offer_ids, started_at, finished_at) VALUES ($1, $2, 'done', $3, $4, $4)`,
        [marie, daf, [searched, twice], tenDaysAgo],
      );
      await database.query(`INSERT INTO job_digest (profile_id, candidate_id, job_offer_ids, sent_at) VALUES ($1, $2, $3, $4)`, [daf, marie, [digested], fiveDaysAgo]);
      await seedReceivedOfferEmail(database, {
        candidateId: marie,
        receivedAt: fiveDaysAgo,
        offers: [
          { disposition: "new", jobOfferId: emailed, profileId: null, matchScore: 40 },
          { disposition: "new", jobOfferId: twice, profileId: daf, matchScore: 90 },
        ],
      });
      const conversation = await database.query<{ id: string }>(
        `INSERT INTO coach_conversation (id, candidate_id, profile_id, title, created_at, last_message_at) VALUES (gen_random_uuid(), $1, $2, 'Lien', $3, $3) RETURNING id`,
        [marie, daf, fiveDaysAgo],
      );
      await database.query(`INSERT INTO coach_message (conversation_id, author, text, created_at, job_offer_id) VALUES ($1, 'coach', 'J''ai lu cette offre.', $2, $3)`, [conversation.rows[0]!.id, fiveDaysAgo, linked]);

      await backfillOfferBox(database, clock.now);

      const byTitle = Object.fromEntries((await entries()).map((entry) => [entry.jobOffer.title, entry]));
      expect(Object.keys(byTitle).sort()).toEqual(["Collée au coach", "Dans un Job Digest", "Recherche puis email", "Reçue par email", "Trouvée par une recherche"]);
      expect(byTitle["Trouvée par une recherche"]).toMatchObject({ profile: { id: daf }, sources: [{ source: "job_search", at: tenDaysAgo }], firstArrivalAt: tenDaysAgo });
      expect(byTitle["Dans un Job Digest"]).toMatchObject({ sources: [{ source: "job_digest", at: fiveDaysAgo }] });
      expect(byTitle["Reçue par email"]).toMatchObject({ profile: null, sources: [{ source: "email", at: fiveDaysAgo }] });
      expect(byTitle["Collée au coach"]).toMatchObject({ profile: { id: daf }, sources: [{ source: "job_offer_link", at: fiveDaysAgo }] });
      expect(byTitle["Recherche puis email"]).toMatchObject({
        firstArrivalAt: tenDaysAgo,
        sources: [
          { source: "job_search", at: tenDaysAgo },
          { source: "email", at: fiveDaysAgo },
        ],
      });
    });

    it("leaves out what arrived more than 30 days ago and Job Offers posted more than 30 days ago; one with an Application starts « Suivie »", async () => {
      const oldArrival = await stored("Arrivée il y a 40 jours");
      const oldPosting = await stored("Publiée il y a 40 jours", { postedAt: new Date(clock.now.getTime() - 40 * DAY) });
      const freshPosting = await stored("Publiée il y a 3 jours", { postedAt: new Date(clock.now.getTime() - 3 * DAY) });
      const saved = await stored("Déjà enregistrée");
      await database.query(`INSERT INTO job_search (candidate_id, profile_id, status, job_offer_ids, started_at, finished_at) VALUES ($1, $2, 'done', $3, $4, $4)`, [
        marie,
        daf,
        [oldArrival],
        new Date(clock.now.getTime() - 40 * DAY),
      ]);
      await database.query(`INSERT INTO job_search (candidate_id, profile_id, status, job_offer_ids, started_at, finished_at) VALUES ($1, $2, 'done', $3, $4, $4)`, [
        marie,
        daf,
        [oldPosting, freshPosting, saved],
        new Date(clock.now.getTime() - 2 * DAY),
      ]);
      await applications.save(marie, { jobOfferId: saved, profileId: daf });

      await backfillOfferBox(database, clock.now);

      expect((await entries()).map((entry) => [entry.jobOffer.title, entry.state]).sort()).toEqual([
        ["Déjà enregistrée", "followed"],
        ["Publiée il y a 3 jours", "to_handle"],
      ]);
    });

    it("is idempotent, and never gives one Candidate's private Job Offer to another", async () => {
      const shared = await stored("Partagée");
      const theirs = await stored("Privée à Marie", { privateTo: marie });
      const paulsProfile = await createProfile(paul);
      await database.query(`INSERT INTO job_search (candidate_id, profile_id, status, job_offer_ids, started_at, finished_at) VALUES ($1, $2, 'done', $3, $4, $4)`, [
        paul,
        paulsProfile,
        [shared, theirs],
        new Date(clock.now.getTime() - DAY),
      ]);

      await backfillOfferBox(database, clock.now);
      const once = await offerBoxOf(database, paul);
      await backfillOfferBox(database, clock.now);

      expect(await offerBoxOf(database, paul)).toEqual(once);
      expect(once.map((entry) => entry.jobOfferId)).toEqual([shared]);
    });
  });
});
