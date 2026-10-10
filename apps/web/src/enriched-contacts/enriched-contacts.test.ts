import type { MasterCvContent } from "@jobhub/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApplications, migrateApplications, type Applications } from "../applications";
import { STARTING_PLAN_QUOTAS } from "../billing";
import { connectionString, startTestBilling, type TestBilling } from "../billing/test-support";
import type { CompanyDossier, CompanyDossierState } from "../company-dossiers";
import { createJobOffers, migrateJobOffers, type JobOffers } from "../job-offers";
import { createProfiles, migrateProfiles, type Profiles } from "../profiles";
import { createEnrichedContacts, migrateEnrichedContacts, type CompanyDossierSource, type EnrichedContacts } from "./index";
import { ContactProviderError, type ContactDetails, type ContactEnrichmentProvider, type FoundPerson, type PeopleSearch } from "./providers/types";

const masterCv: MasterCvContent = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [],
  education: [],
  skills: ["IFRS"],
  languages: [],
};

const OFFER = { source: { url: "https://www.apec.fr/offre/42" }, title: "DAF H/F", content: "Nous recherchons un DAF.", employer: "Acme Industrie", location: "Lyon" };

const DOSSIER: CompanyDossier = {
  source: "web",
  reliability: "less_reliable",
  employer: "Acme Industrie",
  builtAt: new Date("2026-10-01T10:00:00Z"),
  website: "https://www.acme-industrie.fr/",
  sources: [],
  suggestedContactRoles: ["hiring_manager", "hr_director", "talent_acquisition"],
};

const CLAIRE: FoundPerson = { providerPersonId: "p-claire", name: "Claire M.", jobTitle: "DRH" };
const HUGO: FoundPerson = { providerPersonId: "p-hugo", name: "Hugo B.", jobTitle: "Responsable recrutement" };
const CLAIRE_DETAILS: ContactDetails = { providerPersonId: "p-claire", name: "Claire Martin", jobTitle: "DRH", emails: ["claire.martin@acme-industrie.fr"], phones: [] };

/** A provider answering from memory, recording what it was asked. */
function fakeProvider(overrides: Partial<ContactEnrichmentProvider> = {}) {
  const searches: PeopleSearch[] = [];
  const reveals: string[] = [];
  const details = new Map([[CLAIRE.providerPersonId, CLAIRE_DETAILS]]);
  const provider: ContactEnrichmentProvider = {
    id: "apollo",
    findPeople: async (search) => {
      searches.push(search);
      return [CLAIRE, HUGO];
    },
    getContactDetails: async ({ providerPersonId }) => {
      reveals.push(providerPersonId);
      return details.get(providerPersonId) ?? null;
    },
    ...overrides,
  };
  return { provider, searches, reveals };
}

describe.skipIf(!connectionString)("Enriched Contacts (needs Postgres: DATABASE_URL)", () => {
  let t: TestBilling;
  let profiles: Profiles;
  let jobOffers: JobOffers;
  let applications: Applications;
  let dossiers: Map<string, CompanyDossierState>;
  let companyDossiers: CompanyDossierSource;
  let clock: { now: Date };
  let marie: string;
  let paul: string;
  let applicationId: string;

  function contactsWith(provider: ContactEnrichmentProvider | null): EnrichedContacts {
    return createEnrichedContacts(t.database, {
      applications,
      companyDossiers,
      quota: { allows: (id) => t.billing.allows(id, "enrichedContacts"), use: (id) => t.billing.use(id, "enrichedContacts"), release: (id) => t.billing.release(id, "enrichedContacts") },
      provider,
      now: () => clock.now,
    });
  }

  /** Lets the Free Plan have `count` Enriched Contacts a month, as the Premium Plan does. */
  const includeEnrichedContacts = (count: number | null) => t.billing.setPlanQuotas("free", { ...STARTING_PLAN_QUOTAS.free, enrichedContacts: count });

  async function saveApplication(owner: string) {
    const profile = await profiles.create(owner, { masterCv, searchCriteria: { targetRole: "DAF", location: "Lyon" } });
    const captured = await jobOffers.capture(OFFER);
    if (!profile.ok || !captured.ok) throw new Error("fixture refused");
    const saved = await applications.save(owner, { jobOfferId: captured.jobOffer.id, profileId: profile.profile.id });
    if (!saved.ok) throw new Error("fixture Application refused");
    return saved.application.id;
  }

  beforeEach(async () => {
    t = await startTestBilling();
    await migrateProfiles(t.database);
    await migrateJobOffers(t.database);
    await migrateApplications(t.database);
    await migrateEnrichedContacts(t.database);
    profiles = createProfiles(t.database);
    jobOffers = createJobOffers(t.database);
    applications = createApplications(t.database, { jobOffers, profiles });
    dossiers = new Map();
    companyDossiers = { get: async (owner, id) => (owner === marie ? (dossiers.get(id) ?? { status: "not_built" }) : null) };
    clock = { now: new Date("2026-10-08T09:30:00Z") };
    marie = (await t.signUp("marie.dupont@example.fr")).id;
    paul = (await t.signUp("paul.martin@example.fr")).id;
    applicationId = await saveApplication(marie);
    dossiers.set(applicationId, { status: "built", dossier: DOSSIER });
  }, 60_000);
  afterEach(async () => {
    await t.stop();
  }, 60_000);

  it("is off when no provider is configured (or its DPA is not signed): nothing can be found or revealed", async () => {
    const contacts = contactsWith(null);
    await includeEnrichedContacts(20);

    expect(await contacts.get(marie, applicationId)).toEqual({ enabled: false, searchable: false, found: [], contacts: [] });
    expect(await contacts.find(marie, applicationId)).toEqual({ ok: false, error: "disabled" });
  });

  it("finds people at the employer holding the Company Dossier's Suggested Contact Roles", async () => {
    const { provider, searches, reveals } = fakeProvider();
    const contacts = contactsWith(provider);
    await includeEnrichedContacts(20);

    const result = await contacts.find(marie, applicationId);

    expect(result).toMatchObject({
      ok: true,
      state: {
        enabled: true,
        searchable: true,
        found: [
          { name: "Claire M.", jobTitle: "DRH", source: { provider: "apollo", providerPersonId: "p-claire", foundAt: clock.now } },
          { name: "Hugo B.", jobTitle: "Responsable recrutement", source: { provider: "apollo", providerPersonId: "p-hugo", foundAt: clock.now } },
        ],
        contacts: [],
      },
    });
    expect(searches).toHaveLength(1);
    expect(searches[0]).toMatchObject({ companyName: "Acme Industrie", companyDomain: "acme-industrie.fr" });
    expect(searches[0]!.jobTitles).toEqual(expect.arrayContaining(["DRH", "Directeur des ressources humaines", "Responsable recrutement", "Talent Acquisition"]));
    expect(reveals).toEqual([]);
    // Finding people reveals nothing: no Enriched Contact is counted yet.
    expect((await t.billing.entitlements(marie)).usedThisMonth.enrichedContacts).toBe(0);
  });

  it("is Premium only: a Plan without Enriched Contacts gets the Upgrade Prompt and the provider is not asked", async () => {
    const { provider, searches } = fakeProvider();
    const contacts = contactsWith(provider);

    expect(await contacts.find(marie, applicationId)).toEqual({
      ok: false,
      error: "quota_exceeded",
      refusal: { allowed: false, quota: "enrichedContacts", plan: "free", limit: 0, upgradeTo: "premium" },
    });
    expect(searches).toEqual([]);
  });

  it("needs a built Company Dossier to know who to look for", async () => {
    const contacts = contactsWith(fakeProvider().provider);
    await includeEnrichedContacts(20);
    dossiers.set(applicationId, { status: "not_built" });

    expect(await contacts.find(marie, applicationId)).toEqual({ ok: false, error: "no_dossier" });
  });

  it("reveals a found person's contact details, counted against the monthly Plan Quota, with their source and retrieval date", async () => {
    const { provider, reveals } = fakeProvider();
    const contacts = contactsWith(provider);
    await includeEnrichedContacts(20);
    const found = await contacts.find(marie, applicationId);
    const claire = found.ok ? found.state.found[0]! : undefined;
    clock.now = new Date("2026-10-08T10:00:00Z");

    const result = await contacts.reveal(marie, applicationId, claire!.id);

    expect(result).toMatchObject({
      ok: true,
      state: {
        found: [{ name: "Hugo B." }],
        contacts: [
          {
            id: claire!.id,
            name: "Claire Martin",
            jobTitle: "DRH",
            emails: ["claire.martin@acme-industrie.fr"],
            phones: [],
            source: { provider: "apollo", providerPersonId: "p-claire", retrievedAt: new Date("2026-10-08T10:00:00Z") },
          },
        ],
      },
    });
    expect(reveals).toEqual(["p-claire"]);
    expect((await t.billing.entitlements(marie)).usedThisMonth.enrichedContacts).toBe(1);
    expect(await contacts.contact(marie, applicationId, claire!.id)).toMatchObject({ name: "Claire Martin", emails: ["claire.martin@acme-industrie.fr"] });

    // Revealing it again neither asks the provider nor counts twice.
    await contacts.reveal(marie, applicationId, claire!.id);
    expect(reveals).toEqual(["p-claire"]);
    expect((await t.billing.entitlements(marie)).usedThisMonth.enrichedContacts).toBe(1);
  });

  it("stops at the monthly Plan Quota, before asking the provider", async () => {
    const { provider, reveals } = fakeProvider();
    const contacts = contactsWith(provider);
    await includeEnrichedContacts(1);
    const found = await contacts.find(marie, applicationId);
    const [claire, hugo] = found.ok ? found.state.found : [];
    await contacts.reveal(marie, applicationId, claire!.id);

    expect(await contacts.reveal(marie, applicationId, hugo!.id)).toMatchObject({ ok: false, error: "quota_exceeded", refusal: { quota: "enrichedContacts", limit: 1 } });
    expect(reveals).toEqual(["p-claire"]);
  });

  it("does not count a reveal the provider could not answer", async () => {
    const failing = fakeProvider({
      getContactDetails: async () => {
        throw new ContactProviderError("apollo", "rate_limited");
      },
    });
    const contacts = contactsWith(failing.provider);
    await includeEnrichedContacts(20);
    const found = await contacts.find(marie, applicationId);
    const [claire, hugo] = found.ok ? found.state.found : [];

    expect(await contacts.reveal(marie, applicationId, claire!.id)).toEqual({ ok: false, error: "unavailable" });
    // Hugo is unknown to the fake provider: no details.
    const working = contactsWith(fakeProvider().provider);
    expect(await working.reveal(marie, applicationId, hugo!.id)).toEqual({ ok: false, error: "no_details" });
    expect((await t.billing.entitlements(marie)).usedThisMonth.enrichedContacts).toBe(0);
  });

  it("cannot search with a provider that only enriches known profiles (Kaspr)", async () => {
    const contacts = contactsWith(fakeProvider({ id: "kaspr", findPeople: null }).provider);
    await includeEnrichedContacts(20);

    expect(await contacts.get(marie, applicationId)).toMatchObject({ enabled: true, searchable: false });
    expect(await contacts.find(marie, applicationId)).toEqual({ ok: false, error: "search_unsupported" });
  });

  it("keeps each Candidate's contacts to themselves", async () => {
    const contacts = contactsWith(fakeProvider().provider);
    await includeEnrichedContacts(20);
    const found = await contacts.find(marie, applicationId);
    const claire = found.ok ? found.state.found[0]! : undefined;

    expect(await contacts.get(paul, applicationId)).toBeNull();
    expect(await contacts.find(paul, applicationId)).toEqual({ ok: false, error: "not_found" });
    expect(await contacts.reveal(paul, applicationId, claire!.id)).toEqual({ ok: false, error: "not_found" });
    expect(await contacts.contact(paul, applicationId, claire!.id)).toBeNull();
    expect(await contacts.reveal(marie, applicationId, "not-a-uuid")).toEqual({ ok: false, error: "not_found" });
  });
});
