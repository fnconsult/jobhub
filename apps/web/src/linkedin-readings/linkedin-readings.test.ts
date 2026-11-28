import type { MasterCvContent } from "@jobhub/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApplications, migrateApplications, type Applications } from "../applications";
import { connectionString, startTestBilling, type TestBilling } from "../billing/test-support";
import { createJobOffers, migrateJobOffers, type JobOffers } from "../job-offers";
import { createProfiles, migrateProfiles, type Profiles } from "../profiles";
import { createTargetCompanies, migrateTargetCompanies } from "../target-companies";
import { createLinkedInReadings, migrateLinkedInReadings, type LinkedInReadings } from "./index";

const masterCv: MasterCvContent = {
  fullName: "Nathalie Exemple",
  headline: "Acheteuse industrielle",
  email: "nathalie.exemple@example.fr",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [],
  education: [],
  skills: [],
  languages: [],
};

const PEOPLE_PAGE = "https://www.linkedin.com/company/exemple-industrie-fictive/people/?facetCurrentFunction=8";

/** A Reading of Exemple Industrie Fictive's « Achats » people, as the extension sends it, with what it must never keep. */
const peopleReading = (people = [{ name: "Camille Fictive", role: "Responsable achats" }, { name: "Lou Inventé", role: "Acheteur projets" }]) => ({
  page: { kind: "people", url: PEOPLE_PAGE },
  company: "Exemple Industrie Fictive",
  department: "Achats",
  people: people.map((person) => ({ ...person, profileUrl: "https://www.linkedin.com/in/x/", location: "Lyon" })),
});

describe.skipIf(!connectionString)("LinkedIn Readings: the people the extension read on LinkedIn, kept as contacts (needs Postgres: DATABASE_URL; ADR-0119, #1164)", () => {
  let t: TestBilling;
  let profiles: Profiles;
  let jobOffers: JobOffers;
  let applications: Applications;
  let readings: LinkedInReadings;
  let clock: { now: Date };
  let nathalie: string;
  let paul: string;
  let profileId: string;

  async function applyTo(candidateId: string, employer: string, title = "Acheteur industriel H/F") {
    const captured = await jobOffers.capture({ source: { url: `https://www.welcometothejungle.com/offre/${encodeURIComponent(employer)}-${candidateId}` }, title, content: "Achats de pièces usinées.", employer, location: "Lyon" });
    if (!captured.ok) throw new Error("fixture refused");
    const profile = (await profiles.list(candidateId))[0]!;
    const saved = await applications.save(candidateId, { jobOfferId: captured.jobOffer.id, profileId: profile.id });
    if (!saved.ok) throw new Error("fixture refused");
    return saved.application.id;
  }

  async function targetCompany(candidateId: string, name: string, onProfile = profileId) {
    const { rows } = await t.database.query<{ id: string }>(
      `INSERT INTO target_company (profile_id, candidate_id, company_key, name, origin) VALUES ($1, $2, $3, $4, 'candidate') RETURNING id`,
      [onProfile, candidateId, `name:${name.toLowerCase()}`, name],
    );
    return rows[0]!.id;
  }

  beforeEach(async () => {
    t = await startTestBilling();
    await migrateProfiles(t.database);
    await migrateJobOffers(t.database);
    await migrateApplications(t.database);
    await migrateTargetCompanies(t.database);
    await migrateLinkedInReadings(t.database);
    await migrateLinkedInReadings(t.database); // safe to run twice
    profiles = createProfiles(t.database);
    jobOffers = createJobOffers(t.database);
    applications = createApplications(t.database, { jobOffers, profiles });
    clock = { now: new Date("2026-11-28T10:00:00+01:00") };
    readings = createLinkedInReadings(t.database, { now: () => clock.now });
    nathalie = (await t.signUp("nathalie.exemple@example.fr")).id;
    paul = (await t.signUp("paul.exemple@example.fr")).id;
    for (const candidate of [nathalie, paul]) {
      const profile = await profiles.create(candidate, { masterCv, searchCriteria: { targetRole: "Acheteuse industrielle", locations: ["Lyon"] } });
      if (!profile.ok) throw new Error("fixture refused");
      if (candidate === nathalie) profileId = profile.profile.id;
    }
  });

  afterEach(async () => {
    await t.stop();
  });

  it("files the people of a company's page as contacts of the Application at that employer, marked LinkedIn, with their name, role and company only", async () => {
    const applicationId = await applyTo(nathalie, "EXEMPLE INDUSTRIE FICTIVE SAS");

    const kept = await readings.keep(nathalie, peopleReading());

    expect(kept).toMatchObject({
      ok: true,
      reading: {
        page: { kind: "people", url: "https://www.linkedin.com/company/exemple-industrie-fictive/people/" },
        company: "Exemple Industrie Fictive",
        department: "Achats",
        filedIn: [{ kind: "application", id: applicationId, name: "Acheteur industriel H/F" }],
        readAt: clock.now,
      },
    });
    const contacts = await readings.contactsOf(nathalie, { applicationId });
    expect(contacts).toEqual([
      { id: expect.any(String), name: "Camille Fictive", role: "Responsable achats", company: "Exemple Industrie Fictive", source: "linkedin", readAt: clock.now },
      { id: expect.any(String), name: "Lou Inventé", role: "Acheteur projets", company: "Exemple Industrie Fictive", source: "linkedin", readAt: clock.now },
    ]);
    // Nothing else of theirs is stored, in any column.
    const { rows } = await t.database.query(`SELECT * FROM linkedin_contact`);
    expect(JSON.stringify(rows)).not.toMatch(/\/in\/|Lyon/);
  });

  it("files them as contacts of a Target Company of that name, when no Application is at that employer", async () => {
    const id = await targetCompany(nathalie, "Exemple Industrie Fictive");

    const kept = await readings.keep(nathalie, peopleReading());

    expect(kept).toMatchObject({ ok: true, reading: { filedIn: [{ kind: "target_company", id, name: "Exemple Industrie Fictive", profileId }] } });
    expect((await readings.contactsOf(nathalie, { targetCompanyId: id })).map((contact) => contact.name)).toEqual(["Camille Fictive", "Lou Inventé"]);
  });

  it("shows a Target Company's LinkedIn contacts on its card, each company with its own, and none of another Candidate's", async () => {
    const id = await targetCompany(nathalie, "Exemple Industrie Fictive");
    const other = await targetCompany(nathalie, "Autre Société Fictive");
    await readings.keep(nathalie, peopleReading());

    const byCompany = await readings.contactsOfTargetCompanies(nathalie, [id, other, "not-an-id"]);

    expect([...byCompany.keys()]).toEqual([id]);
    expect(byCompany.get(id)).toEqual([
      { id: expect.any(String), name: "Camille Fictive", role: "Responsable achats", company: "Exemple Industrie Fictive", source: "linkedin", readAt: clock.now },
      { id: expect.any(String), name: "Lou Inventé", role: "Acheteur projets", company: "Exemple Industrie Fictive", source: "linkedin", readAt: clock.now },
    ]);
    expect((await readings.contactsOfTargetCompanies(paul, [id])).size).toBe(0);
  });

  it("carries a Target Company's LinkedIn contacts to the Spontaneous Application prepared there, without doubling anyone read again", async () => {
    const id = await targetCompany(nathalie, "Exemple Industrie Fictive");
    await readings.keep(nathalie, peopleReading());
    const targets = createTargetCompanies(t.database, { jobOffers, applications });

    const prepared = await targets.prepareSpontaneousApplication(nathalie, profileId, id);
    if (!prepared.ok) throw new Error("not prepared");

    expect((await readings.contactsOf(nathalie, { applicationId: prepared.applicationId })).map((contact) => contact.name)).toEqual(["Camille Fictive", "Lou Inventé"]);
    // Read again once prepared, the people are filed with both: the Application still shows each once, as read last.
    clock.now = new Date("2026-11-29T10:00:00+01:00");
    const again = await readings.keep(nathalie, peopleReading([{ name: "Camille Fictive", role: "Directrice achats" }]));
    expect(again.ok && again.reading.filedIn.map((place) => `${place.kind}:${place.id}`).sort()).toEqual([`application:${prepared.applicationId}`, `target_company:${id}`].sort());
    expect((await readings.contactsOf(nathalie, { applicationId: prepared.applicationId })).map(({ name, role, readAt }) => ({ name, role, readAt }))).toEqual([
      { name: "Camille Fictive", role: "Directrice achats", readAt: clock.now },
      { name: "Lou Inventé", role: "Acheteur projets", readAt: new Date("2026-11-28T10:00:00+01:00") },
    ]);
    // Another Candidate's Application is never shown Nathalie's Target Company's contacts.
    expect(await readings.contactsOf(paul, { applicationId: prepared.applicationId })).toEqual([]);
  });

  it("keeps no one when the company is neither an Application's employer nor a Target Company: the Reading only says how many it read", async () => {
    await applyTo(nathalie, "Autre Société Fictive");

    const kept = await readings.keep(nathalie, peopleReading());

    expect(kept).toMatchObject({ ok: true, reading: { filedIn: [], people: [], peopleRead: 2 } });
    const { rows } = await t.database.query(`SELECT count(*)::int AS n FROM linkedin_contact`);
    expect(rows[0].n).toBe(0);
  });

  it("reads the same page again without doubling anyone: a person's role is brought up to date", async () => {
    const applicationId = await applyTo(nathalie, "Exemple Industrie Fictive");
    await readings.keep(nathalie, peopleReading());
    clock.now = new Date("2026-11-29T10:00:00+01:00");

    await readings.keep(nathalie, peopleReading([{ name: "Camille Fictive", role: "Directrice achats" }]));

    const contacts = await readings.contactsOf(nathalie, { applicationId });
    expect(contacts.map(({ name, role }) => ({ name, role }))).toEqual([
      { name: "Camille Fictive", role: "Directrice achats" },
      { name: "Lou Inventé", role: "Acheteur projets" },
    ]);
  });

  it("never files into another Candidate's Application or Target Company, nor shows them theirs", async () => {
    const paulsApplication = await applyTo(paul, "Exemple Industrie Fictive");

    const kept = await readings.keep(nathalie, peopleReading());

    expect(kept).toMatchObject({ ok: true, reading: { filedIn: [] } });
    expect(await readings.contactsOf(paul, { applicationId: paulsApplication })).toEqual([]);
    await readings.keep(paul, peopleReading());
    expect(await readings.contactsOf(nathalie, { applicationId: paulsApplication })).toEqual([]);
    expect(await readings.latest(nathalie, { since: new Date(0) })).toMatchObject({ filedIn: [] });
  });

  it("refuses what is not a Reading: a profile's page, another site, no company", async () => {
    await applyTo(nathalie, "Exemple Industrie Fictive");
    for (const sent of [
      { ...peopleReading(), page: { kind: "people", url: "https://www.linkedin.com/in/camille-fictive/" } },
      { ...peopleReading(), page: { kind: "company", url: "https://www.example.org/company/x/" } },
      { ...peopleReading(), company: "" },
      "Camille Fictive",
    ]) {
      expect(await readings.keep(nathalie, sent)).toEqual({ ok: false, error: "invalid" });
    }
    const { rows } = await t.database.query(`SELECT count(*)::int AS n FROM linkedin_reading`);
    expect(rows[0].n).toBe(0);
  });

  it("gives the AI Coach the Candidate's latest Reading since a time, of a page when it names one", async () => {
    await applyTo(nathalie, "Exemple Industrie Fictive");
    await readings.keep(nathalie, { page: { kind: "company", url: "https://www.linkedin.com/company/exemple-industrie-fictive/" }, company: "Exemple Industrie Fictive", people: [] });
    clock.now = new Date("2026-11-28T10:05:00+01:00");
    await readings.keep(nathalie, peopleReading());

    expect(await readings.latest(nathalie, { since: new Date("2026-11-28T10:00:00+01:00") })).toMatchObject({
      page: { kind: "people" },
      department: "Achats",
      people: [{ name: "Camille Fictive" }, { name: "Lou Inventé" }],
    });
    expect(await readings.latest(nathalie, { since: new Date("2026-11-28T09:00:00+01:00"), url: "https://www.linkedin.com/company/exemple-industrie-fictive/about/" })).toMatchObject({
      page: { kind: "company" },
      people: [],
    });
    expect(await readings.latest(nathalie, { since: new Date("2026-11-28T10:06:00+01:00") })).toBeNull();
    expect(await readings.latest(paul, { since: new Date(0) })).toBeNull();
  });

  it("goes with the Application, the Target Company and the Candidate", async () => {
    const applicationId = await applyTo(nathalie, "Exemple Industrie Fictive");
    const targetId = await targetCompany(nathalie, "Exemple Industrie Fictive");
    await readings.keep(nathalie, peopleReading());
    const count = async () => (await t.database.query(`SELECT count(*)::int AS n FROM linkedin_contact`)).rows[0].n;
    expect(await count()).toBe(4);

    await t.database.query(`DELETE FROM application WHERE id = $1`, [applicationId]);
    expect(await count()).toBe(2);
    await t.database.query(`DELETE FROM target_company WHERE id = $1`, [targetId]);
    expect(await count()).toBe(0);
    await t.database.query(`DELETE FROM candidate WHERE id = $1`, [nathalie]);
    expect((await t.database.query(`SELECT count(*)::int AS n FROM linkedin_reading`)).rows[0].n).toBe(0);
  });

  it("never calls LinkedIn, nor anything else over the network: it keeps what the extension sent", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    try {
      await applyTo(nathalie, "Exemple Industrie Fictive");
      await readings.keep(nathalie, peopleReading());
      await readings.latest(nathalie, { since: new Date(0) });
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });
});
