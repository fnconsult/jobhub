/**
 * The employer's side of an Application, as the AI Coach proposes it (ADR-0114), on in-memory domain modules scoped to
 * their Candidate: rebuilding the Company Dossier (« Mettre à jour »), confirming or correcting its employer (a form),
 * searching for contacts and revealing one (Premium, with its Plan Quota). The AI Coach never writes the dossier's content,
 * and an Enriched Contact's details never reach it.
 */
import { describe, expect, it } from "vitest";
import type { Application } from "../applications";
import type { QuotaRefusal } from "../billing/upgrade-prompt";
import type { CompanyDossierResult, CompanyDossierState } from "../company-dossiers";
import type { EnrichedContactsResult, EnrichedContactsState } from "../enriched-contacts";
import { EMPLOYER_ACTIONS, employerCoachActions, type EmployerActionSources } from "./employer";
import { createCoachActions, type CoachAction, type CoachActionCall, type ProposalCall, type ProposedChange } from "./index";

const application = (id: string, profileId: string): Application =>
  ({ id, status: "applied", jobOffer: { id: `o-${id}`, title: "Contrôleuse de gestion", employer: "Airbus" }, profile: { id: profileId, name: "DAF" }, interviews: [] }) as unknown as Application;

const BUILT_AT = new Date("2026-10-30T10:00:00Z");
const built: CompanyDossierState = {
  status: "built",
  dossier: {
    source: "french_register",
    reliability: "official",
    employer: "Airbus",
    builtAt: BUILT_AT,
    siren: "383474814",
    name: "AIRBUS",
    financials: [],
    executiveRoles: [],
    suggestedContactRoles: ["hr_director"],
    news: [],
    newsSearched: true,
  },
};

const FOUND_AT = new Date("2026-10-31T10:00:00Z");
const contacts = (): EnrichedContactsState => ({
  enabled: true,
  searchable: true,
  found: [{ id: "c-found", name: "Paul Martin", jobTitle: "Talent Acquisition", source: { provider: "lusha", providerPersonId: "p2", foundAt: FOUND_AT } }],
  contacts: [
    {
      id: "c-revealed",
      name: "Sophie Bernard",
      jobTitle: "DRH",
      emails: ["sophie.bernard@airbus.example"],
      phones: ["+33 6 98 76 54 32"],
      source: { provider: "lusha", providerPersonId: "p1", foundAt: FOUND_AT, retrievedAt: FOUND_AT },
    },
  ],
});

const PREMIUM_REFUSAL: QuotaRefusal = {
  allowed: false,
  quota: "enrichedContacts",
  plan: "standard",
  planName: { fr: "Standard", en: "Standard" },
  limit: 0,
  used: 0,
  upgradeTo: "premium",
  upgradeToName: { fr: "Premium", en: "Premium" },
} as unknown as QuotaRefusal;

/** Marie's world: an Application of her active Profile and one of her archived Profile; Paul has none. */
function world() {
  const applications: Record<string, Application[]> = { marie: [application("a1", "p-daf"), application("a-old", "p-old")] };
  const mine = (candidateId: string, applicationId: string) => applications[candidateId]?.find((each) => each.id === applicationId) ?? null;
  const state = {
    dossier: built as CompanyDossierState,
    contacts: contacts(),
    quota: { used: 1, limit: 5 as number | null, refusal: null as QuotaRefusal | null },
    confirmed: [] as unknown[],
    found: 0,
    revealed: [] as string[],
    confirmResult: null as CompanyDossierResult | null,
    findResult: null as EnrichedContactsResult | null,
    revealResult: null as EnrichedContactsResult | null,
  };
  const sources: EmployerActionSources = {
    applications: { get: async (candidateId, id) => mine(candidateId, id) },
    profiles: {
      list: async (candidateId) =>
        candidateId === "marie"
          ? [
              { id: "p-daf", name: "DAF", archived: false },
              { id: "p-old", name: "Ancien", archived: true },
            ]
          : [],
    },
    companyDossiers: {
      get: async (candidateId, id) => (mine(candidateId, id) ? state.dossier : null),
      confirmEmployer: async (candidateId, id, input) => {
        if (!mine(candidateId, id)) return { ok: false, error: "not_found" };
        state.confirmed.push(input);
        return state.confirmResult ?? { ok: true, state: built };
      },
    },
    enrichedContacts: {
      get: async (candidateId, id) => (mine(candidateId, id) ? state.contacts : null),
      find: async (candidateId, id) => {
        if (!mine(candidateId, id)) return { ok: false, error: "not_found" };
        state.found += 1;
        return state.findResult ?? { ok: true, state: state.contacts };
      },
      reveal: async (candidateId, id, contactId) => {
        if (!mine(candidateId, id)) return { ok: false, error: "not_found" };
        state.revealed.push(contactId);
        return state.revealResult ?? { ok: true, state: state.contacts };
      },
    },
    enrichedContactQuota: async () => state.quota,
  };
  return { sources, state };
}

const call = (candidateId = "marie", more: Partial<CoachActionCall> = {}): CoachActionCall => ({ candidateId, language: "fr", ...more });
const onApplication = (candidateId = "marie") => call(candidateId, { inView: { kind: "application", id: "a1" } });
const applied = (candidateId = "marie"): ProposalCall => ({ candidateId, cardId: "card-1", at: new Date("2026-11-05T10:00:00Z"), language: "fr" });
const actionOf = (sources: EmployerActionSources, name: string): CoachAction => employerCoachActions(sources).find((action) => action.name === name)!;

async function proposed(action: CoachAction, args: Record<string, unknown>, at = onApplication()): Promise<ProposedChange> {
  const result = await action.run(action.schema.parse(args), at);
  if (!result.ok || result.proposes === false) throw new Error(`nothing proposed: ${JSON.stringify(result)}`);
  return result.data as ProposedChange;
}

describe("the employer's Coach Actions (ADR-0114)", () => {
  it("are four proposals of the Candidatures group; none deletes, none writes the dossier's content: their arguments are ids and an employer's name only", () => {
    const actions = employerCoachActions(world().sources);

    expect(actions.map(({ name, group, kind, copiesText }) => ({ name, group, kind, copiesText }))).toEqual([
      { name: "propose_company_dossier_rebuild", group: "applications", kind: "propose", copiesText: false },
      { name: "propose_dossier_employer", group: "applications", kind: "propose", copiesText: true },
      { name: "propose_contact_search", group: "applications", kind: "propose", copiesText: false },
      { name: "propose_contact_reveal", group: "applications", kind: "propose", copiesText: false },
    ]);
    expect(actions.map((action) => Object.keys(action.schema.shape))).toEqual([["applicationId"], ["applicationId", "employer"], ["applicationId"], ["applicationId", "contactId"]]);
    for (const action of actions) {
      expect(action.apply).toBeTypeOf("function");
      expect(action.undo).toBeUndefined();
    }
    expect(actions[0]!.description).toMatch(/jamais le contenu du dossier/);
  });

  it("are all offered with an Application In view: the employer's name is read in full on its form and applied by the Candidate", async () => {
    const actions = createCoachActions({ catalog: employerCoachActions(world().sources), settings: async () => ({ enabled: true, maxRounds: 2 }), externalApis: { record: () => {} } });

    const offered = await actions.forReply("marie", { recorder: { step: async () => undefined as never, site: () => {} }, untrustedInView: true });

    expect(offered?.tools.map((tool) => tool.name)).toEqual(Object.values(EMPLOYER_ACTIONS));
  });

  describe("propose_company_dossier_rebuild: a card « Mettre à jour »", () => {
    it("runs the dossier's build through its page's route, live, its Plan Quota said, and opens the Dossier Section", async () => {
      const { sources } = world();

      const change = await proposed(actionOf(sources, EMPLOYER_ACTIONS.rebuild), {});

      expect(change).toEqual({
        target: { kind: "application", id: "a1", name: "Contrôleuse de gestion · Airbus", href: "/candidatures/a1/dossier" },
        what: "Dossier entreprise",
        before: "Dossier du 30 octobre 2026",
        after: "Mis à jour quand vous lancerez « Mettre à jour » : registre des entreprises ou pages web, et actualités",
        value: {},
        fields: [],
        version: BUILT_AT.toISOString(),
        quota: { label: "Ne compte dans aucun quota de votre offre" },
        launches: true,
        runs: { kind: "company_dossier", url: "/api/applications/a1/company-dossier", body: {}, opens: "/candidatures/a1/dossier" },
      });
    });

    it("is launched from the dossier seen; rebuilt since, a conflict", async () => {
      const { sources, state } = world();
      const action = actionOf(sources, EMPLOYER_ACTIONS.rebuild);
      const change = await proposed(action, {});

      expect(await action.apply!(change, applied())).toEqual({ ok: true });
      state.dossier = { ...built, dossier: { ...(built as Extract<CompanyDossierState, { status: "built" }>).dossier, builtAt: new Date("2026-11-04T10:00:00Z") } };
      expect(await action.apply!(change, applied())).toEqual({ ok: false, error: "conflict" });
      expect(await action.apply!(change, applied("paul"))).toEqual({ ok: false, error: "not_found" });
    });

    it("says to name or confirm the employer first when the dossier waits for it, proposing nothing", async () => {
      const { sources, state } = world();
      state.dossier = { status: "awaiting_confirmation", presumedEmployer: "Airbus Helicopters", agency: "Cabinet Exemple" };
      const action = actionOf(sources, EMPLOYER_ACTIONS.rebuild);

      const result = await action.run(action.schema.parse({}), onApplication());

      expect(result).toMatchObject({ ok: true, proposes: false });
      expect(JSON.stringify(result)).toContain("propose_dossier_employer");
    });

    it("finds nothing for another Candidate's Application or an Archived one; asks which one when none is In view", async () => {
      const { sources } = world();
      const action = actionOf(sources, EMPLOYER_ACTIONS.rebuild);

      expect(await action.run(action.schema.parse({}), onApplication("paul"))).toEqual({ ok: false, error: "not_found" });
      expect(await action.run(action.schema.parse({ applicationId: "a-old" }), call())).toEqual({ ok: false, error: "not_found" });
      expect(await action.run(action.schema.parse({}), call())).toMatchObject({ ok: true, proposes: false });
    });
  });

  describe("propose_dossier_employer: a card with a form, confirming or correcting the Presumed Employer", () => {
    it("proposes the employer named, the presumed one before, in the dossier's form", async () => {
      const { sources, state } = world();
      state.dossier = { status: "awaiting_confirmation", presumedEmployer: "Airbus Helicopters", agency: "Cabinet Exemple" };

      const change = await proposed(actionOf(sources, EMPLOYER_ACTIONS.employer), { employer: "Airbus" });

      expect(change).toMatchObject({
        target: { kind: "application", id: "a1", href: "/candidatures/a1/dossier" },
        what: "Employeur du dossier entreprise",
        before: "Airbus Helicopters (présumé)",
        after: "Airbus",
        value: { employer: "Airbus" },
        fields: [{ name: "employer", type: "text" }],
      });
    });

    it("« Appliquer » names the employer the Candidate left in the form, and the dossier is built for it", async () => {
      const { sources, state } = world();
      state.dossier = { status: "employer_unknown" };
      const action = actionOf(sources, EMPLOYER_ACTIONS.employer);
      const change = await proposed(action, { employer: "Airbus" });

      expect(await action.apply!({ ...change, value: { employer: "Airbus Defence and Space" } }, applied())).toEqual({ ok: true });
      expect(state.confirmed).toEqual([{ employer: "Airbus Defence and Space" }]);
    });

    it("refuses an employer the register says is not a company, as the page does; a dossier the register could not build fails, nothing applied", async () => {
      const { sources, state } = world();
      const action = actionOf(sources, EMPLOYER_ACTIONS.employer);
      const change = await proposed(action, { employer: "Jean Dupont EI" });

      state.confirmResult = { ok: false, errors: [{ field: "employer", code: "not_a_company" }] };
      expect(await action.apply!(change, applied())).toEqual({ ok: false, error: "invalid", errors: [{ field: "employer", code: "invalid" }] });
      state.confirmResult = { ok: false, error: "unavailable" };
      await expect(action.apply!(change, applied())).rejects.toThrow();
    });

    it("proposes nothing when the employer is already the dossier's", async () => {
      const { sources } = world();

      const action = actionOf(sources, EMPLOYER_ACTIONS.employer);
      expect(await action.run(action.schema.parse({ employer: "airbus" }), onApplication())).toMatchObject({ ok: true, proposes: false });
    });
  });

  describe("propose_contact_search: a card with the Premium Plan Quota", () => {
    it("proposes a search at the employer, not counted, each reveal counting against the week's Plan Quota", async () => {
      const { sources } = world();

      const change = await proposed(actionOf(sources, EMPLOYER_ACTIONS.search), {});

      expect(change).toMatchObject({
        target: { kind: "application", id: "a1", href: "/candidatures/a1/contacts" },
        what: "Recherche de contacts",
        before: "2 personnes trouvées",
        after: "Les personnes qui occupent les fonctions à contacter chez Airbus, sans leurs coordonnées",
        quota: { label: "La recherche ne compte pas ; chaque contact révélé compte 1 contact enrichi sur 5 cette semaine (il vous en reste 4)" },
        fields: [],
      });
      expect(change.quota).not.toHaveProperty("prompt");
    });

    it("shows the Upgrade prompt on a Plan without Enriched Contacts, in place of its buttons", async () => {
      const { sources, state } = world();
      state.quota = { used: 0, limit: 0, refusal: PREMIUM_REFUSAL };

      const change = await proposed(actionOf(sources, EMPLOYER_ACTIONS.search), {});

      expect(change.quota?.label).toBe("Les contacts enrichis ne sont pas inclus dans votre offre");
      expect(change.quota?.prompt).toMatchObject({ upgradeTo: "premium", href: "/abonnement" });
    });

    it("« Appliquer » searches; refused by the Plan Quota since, the card shows the Upgrade prompt", async () => {
      const { sources, state } = world();
      const action = actionOf(sources, EMPLOYER_ACTIONS.search);
      const change = await proposed(action, {});

      expect(await action.apply!(change, applied())).toEqual({ ok: true });
      expect(state.found).toBe(1);
      state.findResult = { ok: false, error: "quota_exceeded", refusal: PREMIUM_REFUSAL };
      expect(await action.apply!(change, applied())).toMatchObject({ ok: false, error: "quota", prompt: { upgradeTo: "premium" } });
    });

    it("says why nothing is proposed: Enriched Contacts off, or no Company Dossier to search from", async () => {
      const { sources, state } = world();
      const action = actionOf(sources, EMPLOYER_ACTIONS.search);

      state.dossier = { status: "not_built" };
      expect(JSON.stringify(await action.run(action.schema.parse({}), onApplication()))).toContain("propose_company_dossier_rebuild");
      state.contacts = { ...contacts(), enabled: false };
      expect(await action.run(action.schema.parse({}), onApplication())).toMatchObject({ ok: true, proposes: false });
    });
  });

  describe("propose_contact_reveal: a card with the Premium Plan Quota", () => {
    it("proposes to reveal a person found, by name and role, counting one against the week's Plan Quota", async () => {
      const { sources } = world();

      const change = await proposed(actionOf(sources, EMPLOYER_ACTIONS.reveal), { contactId: "c-found" });

      expect(change).toMatchObject({
        target: { kind: "application", id: "a1", href: "/candidatures/a1/contacts" },
        what: "Contact enrichi",
        before: "Paul Martin, Talent Acquisition : trouvé, sans coordonnées",
        after: "Ses coordonnées, à lire dans Contacts",
        value: { contactId: "c-found" },
        quota: { label: "1 contact enrichi sur 5 cette semaine : il vous en restera 3" },
      });
    });

    it("« Appliquer » reveals them; refused by the Plan Quota since, the Upgrade prompt", async () => {
      const { sources, state } = world();
      const action = actionOf(sources, EMPLOYER_ACTIONS.reveal);
      const change = await proposed(action, { contactId: "c-found" });

      expect(await action.apply!(change, applied())).toEqual({ ok: true });
      expect(state.revealed).toEqual(["c-found"]);
      state.revealResult = { ok: false, error: "quota_exceeded", refusal: PREMIUM_REFUSAL };
      expect(await action.apply!(change, applied())).toMatchObject({ ok: false, error: "quota" });
    });

    it("proposes nothing for someone already revealed, finds nothing for an unknown person or another Candidate's", async () => {
      const { sources } = world();
      const action = actionOf(sources, EMPLOYER_ACTIONS.reveal);

      expect(await action.run(action.schema.parse({ contactId: "c-revealed" }), onApplication())).toMatchObject({ ok: true, proposes: false });
      expect(await action.run(action.schema.parse({ contactId: "c-unknown" }), onApplication())).toEqual({ ok: false, error: "not_found" });
      expect(await action.run(action.schema.parse({ contactId: "c-found" }), onApplication("paul"))).toEqual({ ok: false, error: "not_found" });
    });

    it("never puts an Enriched Contact's email or phone on a card, nor in what the AI Coach is told", async () => {
      const { sources } = world();

      for (const [name, args] of [
        [EMPLOYER_ACTIONS.search, {}],
        [EMPLOYER_ACTIONS.reveal, { contactId: "c-found" }],
        [EMPLOYER_ACTIONS.reveal, { contactId: "c-revealed" }],
      ] as const) {
        const action = actionOf(sources, name);
        expect(JSON.stringify(await action.run(action.schema.parse(args), onApplication()))).not.toMatch(/@airbus|98 76|\+33/);
      }
    });
  });
});
