/**
 * A company outside the Candidate's Applications, as the AI Coach proposes it (ADR-0119 D1, #1157): through the Target
 * Companies of one of their Profiles, on in-memory domain modules scoped to their Candidate. Read them, add one (a card
 * naming the Profile, its name editable), build its Company Dossier (launched like `propose_company_dossier_rebuild`),
 * search its contacts (Premium, a provider, a built dossier) and prepare a spontaneous application.
 */
import { describe, expect, it } from "vitest";
import type { QuotaRefusal } from "../billing/upgrade-prompt";
import type { CompanyDossierState } from "../company-dossiers";
import type { EnrichedContactsResult, EnrichedContactsState } from "../enriched-contacts";
import type { AddTargetCompanyResult, TargetCompanyOnProfile } from "../target-companies";
import { candidateObjects, type CandidateObjectSources } from "./candidate-objects";
import { createCoachActions, REDIRECT_ACTION, type CoachAction, type CoachActionCall, type ProposalCall, type ProposedChange } from "./index";
import { createRedirects } from "./redirects";
import { TARGET_COMPANY_ACTIONS, targetCompanyCoachActions, type TargetCompanyActionSources } from "./target-companies";

const ADDED_AT = new Date("2026-11-02T09:00:00Z");
const BUILT_AT = new Date("2026-10-30T10:00:00Z");
const FOUND_AT = new Date("2026-10-31T10:00:00Z");

const company = (more: Partial<TargetCompanyOnProfile> & Pick<TargetCompanyOnProfile, "id" | "name">): TargetCompanyOnProfile => ({
  companyKey: `name:${more.name.toLowerCase()}`,
  origin: "candidate",
  hiringScore: null,
  city: null,
  activity: null,
  headcount: null,
  addedAt: ADDED_AT,
  lastVisitedAt: null,
  notACompanyAt: null,
  jobOffers: [],
  spontaneousApplicationId: null,
  ...more,
});

/** ACME, the Candidate's own, with no Spontaneous Application yet; BETA, La Bonne Boite's, with one whose dossier is built. */
const acme = company({ id: "t-acme", name: "ACME INDUSTRIE", companyKey: "siren:552100554", city: "Lyon" });
const beta = company({ id: "t-beta", name: "BETA LOGISTIQUE", origin: "la_bonne_boite", hiringScore: 64, city: "Vénissieux", spontaneousApplicationId: "a-beta" });

const built: CompanyDossierState = {
  status: "built",
  dossier: {
    source: "french_register",
    reliability: "official",
    employer: "BETA LOGISTIQUE",
    builtAt: BUILT_AT,
    siren: "380129866",
    name: "BETA LOGISTIQUE",
    financials: [],
    executiveRoles: [],
    suggestedContactRoles: ["hr_director"],
    news: [],
    newsSearched: true,
  },
};

const contacts = (): EnrichedContactsState => ({
  enabled: true,
  searchable: true,
  found: [{ id: "c-found", name: "Paul Martin", jobTitle: "Talent Acquisition", source: { provider: "lusha", providerPersonId: "p2", foundAt: FOUND_AT } }],
  contacts: [
    {
      id: "c-revealed",
      name: "Sophie Bernard",
      jobTitle: "DRH",
      emails: ["sophie.bernard@beta.example"],
      phones: ["+33 6 98 76 54 32"],
      source: { provider: "lusha", providerPersonId: "p1", foundAt: FOUND_AT, retrievedAt: FOUND_AT },
    },
  ],
});

const NOT_INCLUDED: QuotaRefusal = {
  allowed: false,
  quota: "enrichedContacts",
  plan: "standard",
  planName: { fr: "Standard", en: "Standard" },
  limit: 0,
  used: 0,
  upgradeTo: "premium",
  upgradeToName: { fr: "Premium", en: "Premium" },
} as unknown as QuotaRefusal;

/** Marie's world: her active Profile « DAF » with ACME and BETA, and an archived one; Paul has none. */
function world() {
  const state = {
    profiles: [
      { id: "p-daf", name: "DAF", archived: false },
      { id: "p-old", name: "Ancien", archived: true },
    ],
    companies: [acme, beta],
    dossier: built as CompanyDossierState,
    contacts: contacts(),
    availability: { enabled: true, searchable: true },
    quota: { used: 1, limit: 5 as number | null, refusal: null as QuotaRefusal | null },
    added: [] as { profileId: string; name: string }[],
    addResult: null as AddTargetCompanyResult | null,
    prepared: [] as string[],
    searched: [] as string[],
    findResult: null as EnrichedContactsResult | null,
  };
  const mine = (candidateId: string, applicationId: string) => candidateId === "marie" && applicationId === "a-beta";
  const sources: TargetCompanyActionSources = {
    profiles: { list: async (candidateId) => (candidateId === "marie" ? state.profiles : []) },
    targetCompanies: {
      onProfile: async (candidateId, profileId) => (candidateId === "marie" && profileId === "p-daf" ? state.companies : null),
      resolve: async (name) => {
        const typed = name.trim();
        if (!typed) return { ok: false, error: "invalid" };
        if (typed === "Jean Dupont") return { ok: false, error: "not_a_company" };
        if (typed.toLowerCase() === "gamma") return { ok: true, name: "GAMMA CONSEIL", companyKey: "siren:412345678", siren: "412345678" };
        return { ok: true, name: typed, companyKey: `name:${typed.toLowerCase()}`, siren: null };
      },
      add: async (candidateId, profileId, name) => {
        if (candidateId !== "marie" || profileId !== "p-daf") return { ok: false, error: "invalid" };
        state.added.push({ profileId, name });
        return state.addResult ?? { ok: true, company: company({ id: "t-new", name }) };
      },
      prepareSpontaneousApplication: async (candidateId, profileId, id) => {
        if (candidateId !== "marie" || profileId !== "p-daf" || !state.companies.some((each) => each.id === id)) return { ok: false, error: "not_found" };
        state.prepared.push(id);
        return { ok: true, applicationId: "a-new" };
      },
    },
    companyDossiers: { get: async (candidateId, id) => (mine(candidateId, id) ? state.dossier : null) },
    enrichedContacts: {
      get: async (candidateId, id) => (mine(candidateId, id) ? state.contacts : null),
      find: async (candidateId, id) => {
        if (!mine(candidateId, id)) return { ok: false, error: "not_found" };
        state.searched.push(id);
        return state.findResult ?? { ok: true, state: state.contacts };
      },
      availability: () => state.availability,
    },
    enrichedContactQuota: async () => state.quota,
  };
  // The reads find the Target Companies as the app's reads do (candidate-objects), with what each needs.
  const reader = candidateObjects({
    profiles: { list: sources.profiles.list, get: async () => null },
    targetCompanies: sources.targetCompanies,
    companyDossiers: sources.companyDossiers,
    enrichedContacts: sources.enrichedContacts,
  } as unknown as CandidateObjectSources);
  return { sources, state, reader, actions: targetCompanyCoachActions(reader, sources) };
}

const call = (candidateId = "marie", more: Partial<CoachActionCall> = {}): CoachActionCall => ({ candidateId, language: "fr", maxTokens: 1_500, ...more });
const applied = (candidateId = "marie"): ProposalCall => ({ candidateId, cardId: "card-1", at: new Date("2026-11-05T10:00:00Z"), language: "fr" });
const actionOf = (actions: CoachAction[], name: string): CoachAction => actions.find((action) => action.name === name)!;

async function run(actions: CoachAction[], name: string, args: Record<string, unknown>, at = call()) {
  const action = actionOf(actions, name);
  return action.run(action.schema.parse(args), at);
}

async function proposed(actions: CoachAction[], name: string, args: Record<string, unknown>, at = call()): Promise<ProposedChange> {
  const result = await run(actions, name, args, at);
  if (!result.ok || result.proposes === false) throw new Error(`nothing proposed: ${JSON.stringify(result)}`);
  return result.data as ProposedChange;
}

describe("the Target Companies' Coach Actions (ADR-0119 D1, #1157)", () => {
  it("are a read and four proposals of the Profil group, each proposal applied by the Candidate's card and none undone", () => {
    const { actions } = world();

    expect(actions.map(({ name, group, kind, copiesText }) => ({ name, group, kind, copiesText }))).toEqual([
      { name: "read_target_companies", group: "profile", kind: "read", copiesText: false },
      { name: "propose_target_company", group: "profile", kind: "propose", copiesText: true },
      { name: "propose_target_company_dossier", group: "profile", kind: "propose", copiesText: false },
      { name: "propose_target_contact_search", group: "profile", kind: "propose", copiesText: false },
      { name: "propose_spontaneous_application", group: "profile", kind: "propose", copiesText: false },
    ]);
    for (const action of actions.slice(1)) {
      expect(action.apply).toBeTypeOf("function");
      expect(action.undo).toBeUndefined();
    }
    // The company's name is read in full on its form and applied by the Candidate: offered whatever is In view.
    expect(actionOf(actions, TARGET_COMPANY_ACTIONS.add).sentByCandidate).toBe(true);
  });

  describe("read_target_companies", () => {
    it("tells each of the Profile's Target Companies with its id, where it came from, its Spontaneous Application, Company Dossier and contacts", async () => {
      const { actions } = world();

      const result = await run(actions, TARGET_COMPANY_ACTIONS.read, { profileId: "p-daf" });

      expect(result).toMatchObject({ ok: true, untrusted: true, pages: ["/profils/p-daf/entreprises-cibles"], seen: [{ type: "profile", name: "DAF" }] });
      const text = (result as { data: string }).data;
      expect(text).toContain("Entreprises cibles du profil « DAF » (id p-daf)");
      expect(text).toMatch(/entreprise cible \(id t-acme\) ACME INDUSTRIE · ajoutée par le candidat · Lyon · aucune candidature spontanée : aucun dossier entreprise/);
      expect(text).toMatch(/entreprise cible \(id t-beta\) BETA LOGISTIQUE · La Bonne Boite, potentiel d'embauche 64\/100 · Vénissieux · candidature spontanée \(id a-beta\) · dossier entreprise constitué le 2026-10-30 · 1 personne trouvée, 1 contact révélé/);
      // Names and roles only, never an Enriched Contact's details.
      expect(text).not.toMatch(/@beta|98 76|Sophie/);
    });

    it("says the dossier is to build, and the contacts off, as they are", async () => {
      const { actions, state } = world();
      state.dossier = { status: "not_built" };
      state.contacts = { ...contacts(), enabled: false, searchable: false };

      const text = (await run(actions, TARGET_COMPANY_ACTIONS.read, { profileId: "p-daf" })) as { data: string };

      expect(text.data).toMatch(/candidature spontanée \(id a-beta\) · dossier entreprise non constitué · recherche de contacts indisponible/);
    });

    it("reads the Profile In view or the only active one; says when there is none; finds nothing for an Archived Profile or another Candidate's", async () => {
      const { actions, state } = world();

      expect(await run(actions, TARGET_COMPANY_ACTIONS.read, {}, call("marie", { inView: { kind: "profile", id: "p-daf" } }))).toMatchObject({ ok: true });
      expect(await run(actions, TARGET_COMPANY_ACTIONS.read, {})).toMatchObject({ ok: true });
      expect(await run(actions, TARGET_COMPANY_ACTIONS.read, { profileId: "p-old" })).toEqual({ ok: false, error: "not_found" });
      expect(await run(actions, TARGET_COMPANY_ACTIONS.read, { profileId: "p-daf" }, call("paul"))).toEqual({ ok: false, error: "not_found" });
      state.companies = [];
      expect(JSON.stringify(await run(actions, TARGET_COMPANY_ACTIONS.read, { profileId: "p-daf" }))).toContain("propose_target_company");
    });
  });

  describe("propose_target_company: a card « Ajouter en Entreprise cible du profil »", () => {
    it("names the Profile and the company as the register lists it, in a form the Candidate can change", async () => {
      const { actions } = world();

      const change = await proposed(actions, TARGET_COMPANY_ACTIONS.add, { name: "gamma" });

      expect(change).toEqual({
        target: { kind: "profile", id: "p-daf", name: "Profil DAF", href: "/profils/p-daf/entreprises-cibles" },
        what: "Entreprise cible",
        before: "Pas dans les entreprises cibles du profil « DAF »",
        after: "GAMMA CONSEIL (SIREN 412345678), ajoutée aux entreprises cibles du profil « DAF »",
        value: { name: "GAMMA CONSEIL" },
        fields: [{ name: "name", label: "Nom de l'entreprise ou SIREN", type: "text" }],
        version: "absent",
      });
    });

    it("« Appliquer » adds the name left in the form; the register refusing it since, or the company added since, nothing added", async () => {
      const { actions, state } = world();
      const action = actionOf(actions, TARGET_COMPANY_ACTIONS.add);
      const change = await proposed(actions, TARGET_COMPANY_ACTIONS.add, { name: "Exemple Industrie" });

      expect(await action.apply!({ ...change, value: { name: "Exemple Industrie SAS" } }, applied())).toEqual({ ok: true });
      expect(state.added).toEqual([{ profileId: "p-daf", name: "Exemple Industrie SAS" }]);
      state.addResult = { ok: false, error: "not_a_company" };
      expect(await action.apply!(change, applied())).toEqual({ ok: false, error: "invalid", errors: [{ field: "name", code: "invalid" }] });
      state.addResult = { ok: false, error: "exists" };
      expect(await action.apply!(change, applied())).toEqual({ ok: false, error: "conflict" });
      expect(await action.apply!(change, applied("paul"))).toEqual({ ok: false, error: "not_found" });
    });

    it("refuses, with its reason, a company the register says is not one: a sole trader's, a private person's (ADR-0007)", async () => {
      const { actions } = world();

      const result = await run(actions, TARGET_COMPANY_ACTIONS.add, { name: "Jean Dupont" });

      expect(result).toMatchObject({ ok: false, error: "refused" });
      expect((result as { reason: string }).reason).toMatch(/registre des entreprises.*entrepreneur individuel.*personne/);
    });

    it("proposes nothing for a company already among the Profile's Target Companies: says what to propose instead", async () => {
      const { actions } = world();

      const result = await run(actions, TARGET_COMPANY_ACTIONS.add, { name: "Acme Industrie", profileId: "p-daf" });

      expect(result).toMatchObject({ ok: true, proposes: false });
      expect(JSON.stringify(result)).toMatch(/t-acme.*propose_target_company_dossier/);
    });

    it("asks which Profile when several are active and none is In view; finds nothing for an Archived Profile or another Candidate's", async () => {
      const { actions, state } = world();
      state.profiles = [...state.profiles, { id: "p-cdg", name: "Contrôle de gestion", archived: false }];

      const asked = await run(actions, TARGET_COMPANY_ACTIONS.add, { name: "gamma" });
      expect(asked).toMatchObject({ ok: true, proposes: false });
      expect(JSON.stringify(asked)).toMatch(/p-daf.*p-cdg/);
      expect(await run(actions, TARGET_COMPANY_ACTIONS.add, { name: "gamma" }, call("marie", { inView: { kind: "profile", id: "p-daf" } }))).toMatchObject({ ok: true, data: { target: { id: "p-daf" } } });
      expect(await run(actions, TARGET_COMPANY_ACTIONS.add, { name: "gamma", profileId: "p-old" })).toEqual({ ok: false, error: "not_found" });
      expect(await run(actions, TARGET_COMPANY_ACTIONS.add, { name: "gamma", profileId: "p-daf" }, call("paul"))).toEqual({ ok: false, error: "not_found" });
    });
  });

  describe("propose_target_company_dossier: launched like « Mettre à jour »", () => {
    it("with no Spontaneous Application yet, prepares it on the click and builds its dossier through the Target Company's route", async () => {
      const { actions } = world();

      const change = await proposed(actions, TARGET_COMPANY_ACTIONS.dossier, { targetCompanyId: "t-acme" });

      expect(change).toEqual({
        target: { kind: "profile", id: "p-daf", name: "Profil DAF", href: "/profils/p-daf/entreprises-cibles" },
        what: "Dossier entreprise de ACME INDUSTRIE",
        before: "Aucun dossier",
        after: "Mis à jour quand vous lancerez « Mettre à jour » : registre des entreprises ou pages web, et actualités",
        also: [{ what: "Candidature spontanée", before: "Aucune candidature spontanée", after: "Préparée chez ACME INDUSTRIE, pour le poste du profil : son dossier entreprise, ses contacts et ses documents" }],
        value: { targetCompanyId: "t-acme" },
        fields: [],
        version: "none:no_application",
        quota: { label: "Ne compte dans aucun quota de votre offre" },
        launches: true,
        runs: { kind: "company_dossier", url: "/api/profiles/p-daf/target-companies/t-acme/company-dossier", body: {}, opens: "/profils/p-daf/entreprises-cibles" },
      });
    });

    it("with one, updates its dossier, opened in its Dossier Section once built; built again since, a conflict", async () => {
      const { actions, state } = world();
      const action = actionOf(actions, TARGET_COMPANY_ACTIONS.dossier);

      const change = await proposed(actions, TARGET_COMPANY_ACTIONS.dossier, { targetCompanyId: "t-beta" });

      expect(change).toMatchObject({
        before: "Dossier du 30 octobre 2026",
        version: BUILT_AT.toISOString(),
        runs: { kind: "company_dossier", url: "/api/profiles/p-daf/target-companies/t-beta/company-dossier", opens: "/candidatures/a-beta/dossier" },
      });
      expect(change.also).toBeUndefined();
      expect(await action.apply!(change, applied())).toEqual({ ok: true });
      state.dossier = { ...built, dossier: { ...(built as Extract<CompanyDossierState, { status: "built" }>).dossier, builtAt: new Date("2026-11-04T10:00:00Z") } };
      expect(await action.apply!(change, applied())).toEqual({ ok: false, error: "conflict" });
      state.companies = [acme];
      expect(await action.apply!(change, applied())).toEqual({ ok: false, error: "not_found" });
    });

    it("says to confirm the employer first when the dossier waits for it, proposing nothing", async () => {
      const { actions, state } = world();
      state.dossier = { status: "awaiting_confirmation", presumedEmployer: "BETA", agency: "Cabinet Exemple" };

      const result = await run(actions, TARGET_COMPANY_ACTIONS.dossier, { targetCompanyId: "t-beta" });

      expect(result).toMatchObject({ ok: true, proposes: false });
      expect(JSON.stringify(result)).toMatch(/propose_dossier_employer.*a-beta/);
    });

    it("finds nothing for a company not among the Profile's, nor for another Candidate", async () => {
      const { actions } = world();

      expect(await run(actions, TARGET_COMPANY_ACTIONS.dossier, { targetCompanyId: "t-unknown" })).toEqual({ ok: false, error: "not_found" });
      expect(await run(actions, TARGET_COMPANY_ACTIONS.dossier, { targetCompanyId: "t-acme", profileId: "p-daf" }, call("paul"))).toEqual({ ok: false, error: "not_found" });
    });
  });

  describe("propose_target_contact_search: on the conditions of propose_contact_search", () => {
    it("proposes a search at the company once its dossier is built, its Plan Quota said", async () => {
      const { actions, state } = world();
      const action = actionOf(actions, TARGET_COMPANY_ACTIONS.contacts);

      const change = await proposed(actions, TARGET_COMPANY_ACTIONS.contacts, { targetCompanyId: "t-beta" });

      expect(change).toMatchObject({
        target: { kind: "application", id: "a-beta", href: "/candidatures/a-beta/contacts" },
        what: "Recherche de contacts",
        before: "2 personnes trouvées",
        after: "Les personnes qui occupent les fonctions à contacter chez BETA LOGISTIQUE, sans leurs coordonnées",
        quota: { label: "La recherche ne compte pas ; chaque contact révélé compte 1 contact enrichi sur 5 cette semaine (il vous en reste 4)" },
        fields: [],
      });
      expect(await action.apply!(change, applied())).toEqual({ ok: true });
      expect(state.searched).toEqual(["a-beta"]);
      state.findResult = { ok: false, error: "quota_exceeded", refusal: NOT_INCLUDED };
      expect(await action.apply!(change, applied())).toMatchObject({ ok: false, error: "quota", prompt: { upgradeTo: "premium" } });
    });

    it("says to build the dossier first when there is none, proposing nothing", async () => {
      const { actions, state } = world();

      expect(JSON.stringify(await run(actions, TARGET_COMPANY_ACTIONS.contacts, { targetCompanyId: "t-acme" }))).toContain("propose_target_company_dossier");
      state.dossier = { status: "not_built" };
      const result = await run(actions, TARGET_COMPANY_ACTIONS.contacts, { targetCompanyId: "t-beta" });
      expect(result).toMatchObject({ ok: true, proposes: false });
      expect(JSON.stringify(result)).toContain("propose_target_company_dossier");
    });

    it("on a Plan without Enriched Contacts: one sentence and a Typed redirect to the Plan, never a card", async () => {
      const { actions, state } = world();
      state.quota = { used: 0, limit: 0, refusal: NOT_INCLUDED };

      const result = await run(actions, TARGET_COMPANY_ACTIONS.contacts, { targetCompanyId: "t-beta" });

      expect(result).toEqual({ ok: false, error: "refused", reason: expect.stringMatching(/offre/), redirect: { target: "plan" } });
    });

    it("without a provider: one sentence and a Typed redirect to the company's dossier, never a card", async () => {
      const { actions, state } = world();
      state.availability = { enabled: false, searchable: false };

      expect(await run(actions, TARGET_COMPANY_ACTIONS.contacts, { targetCompanyId: "t-beta" })).toEqual({
        ok: false,
        error: "refused",
        reason: expect.stringMatching(/indisponible/),
        redirect: { target: "company_dossier", applicationId: "a-beta", profileId: "p-daf" },
      });
      state.availability = { enabled: true, searchable: false };
      expect(await run(actions, TARGET_COMPANY_ACTIONS.contacts, { targetCompanyId: "t-acme" })).toMatchObject({ ok: false, error: "refused", redirect: { target: "company_dossier", profileId: "p-daf" } });
    });

    it("the reply shows the sentence's Typed redirect under it and no card", async () => {
      const { sources, reader, state } = world();
      state.quota = { used: 0, limit: 0, refusal: NOT_INCLUDED };
      const coachActions = createCoachActions({
        catalog: targetCompanyCoachActions(reader, sources),
        settings: async () => ({ enabled: true, maxRounds: 2 }),
        externalApis: { record: () => {} },
        redirects: createRedirects({ profiles: { get: async () => null, list: sources.profiles.list }, applications: { get: async () => null } }),
      });
      const reply = (await coachActions.forReply("marie", { recorder: { step: async (_step: unknown, work: () => unknown) => work(), site: () => {} } as never, untrustedInView: false }))!;

      const outcome = await reply.runTool({ id: "c1", name: TARGET_COMPANY_ACTIONS.contacts, arguments: { targetCompanyId: "t-beta" }, round: 1 } as never, {});

      expect(outcome.error).toBe(true);
      expect(outcome.content).toContain("Abonnement › Changer d'offre");
      expect(reply.proposals()).toEqual([]);
      expect(reply.redirect()).toEqual({ page: "Abonnement", section: null, object: "Changer d'offre", href: "/abonnement" });
      expect(reply.declined()).toEqual([TARGET_COMPANY_ACTIONS.contacts]);
    });
  });

  describe("propose_spontaneous_application", () => {
    it("proposes to prepare it; « Appliquer » prepares it through prepareSpontaneousApplication", async () => {
      const { actions, state } = world();
      const action = actionOf(actions, TARGET_COMPANY_ACTIONS.spontaneous);

      const change = await proposed(actions, TARGET_COMPANY_ACTIONS.spontaneous, { targetCompanyId: "t-acme" });

      expect(change).toEqual({
        target: { kind: "profile", id: "p-daf", name: "Profil DAF", href: "/profils/p-daf/entreprises-cibles" },
        what: "Candidature spontanée",
        before: "Aucune candidature spontanée",
        after: "Préparée chez ACME INDUSTRIE, pour le poste du profil : son dossier entreprise, ses contacts et ses documents",
        value: { targetCompanyId: "t-acme" },
        fields: [],
        version: "none",
      });
      expect(await action.apply!(change, applied())).toEqual({ ok: true });
      expect(state.prepared).toEqual(["t-acme"]);
      expect(await action.apply!(change, applied("paul"))).toEqual({ ok: false, error: "not_found" });
    });

    it("proposes nothing when it is prepared already: says its id, for its documents", async () => {
      const { actions } = world();

      const result = await run(actions, TARGET_COMPANY_ACTIONS.spontaneous, { targetCompanyId: "t-beta" });

      expect(result).toMatchObject({ ok: true, proposes: false });
      expect(JSON.stringify(result)).toContain("a-beta");
    });
  });

  it("are offered with every catalogue's redirect, the company's name read on its form even with a Job Offer In view", async () => {
    const { actions } = world();
    const coachActions = createCoachActions({ catalog: actions, settings: async () => ({ enabled: true, maxRounds: 2 }), externalApis: { record: () => {} } });

    const offered = await coachActions.forReply("marie", { recorder: { step: async () => undefined as never, site: () => {} }, untrustedInView: true });

    expect(offered?.tools.map((tool) => tool.name)).toEqual([...Object.values(TARGET_COMPANY_ACTIONS), REDIRECT_ACTION]);
  });
});
