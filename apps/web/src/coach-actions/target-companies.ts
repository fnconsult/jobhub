/**
 * A company outside the Candidate's Applications, as the AI Coach answers it (ADR-0119 D1, #1157): through the Target
 * Companies of one of their Profiles (../target-companies), each proposal an Action Card the Candidate applies through
 * the module the Profile's « Entreprises cibles » Section calls. A Target Company's Company Dossier and Enriched Contacts
 * are those of its Spontaneous Application, an Application like any other.
 *  - `read_target_companies`: the Profile's Target Companies, each with its id, where it came from, its Spontaneous
 *    Application, its dossier and its contacts (names counted, never their details).
 *  - `propose_target_company`: adds a company by name; its card names the Profile and the company as the company register
 *    lists it, the name editable (`targets.add`). A name the register lists as a sole trader's is refused with its reason
 *    (ADR-0007); one already there proposes nothing, the AI Coach told what to propose on it instead.
 *  - `propose_target_company_dossier`: builds or updates its dossier, launched like `propose_company_dossier_rebuild`
 *    (`runs`): its Spontaneous Application prepared first on the click when there is none, through the Target Company's
 *    own route. Counts against no Plan Quota.
 *  - `propose_target_contact_search`: on the conditions of `propose_contact_search` (Premium, a provider, a built
 *    dossier): without the Plan or a provider, one sentence and a Typed redirect, never a card.
 *  - `propose_spontaneous_application`: prepares it (`prepareSpontaneousApplication`).
 * None undoes: a company added stays until the Candidate sets it aside, a dossier built or a search run stays. Each is
 * scoped to the session's Candidate: another's id, an Archived Profile or a company not among the Profile's is `not_found`.
 *
 *   targetCompanyCoachActions(reader, { profiles, targetCompanies, companyDossiers, enrichedContacts, enrichedContactQuota })
 */
import type { SeenName } from "@jobhub/shared";
import { createI18n } from "@jobhub/shared/i18n";
import * as z from "zod";
import { upgradePrompt } from "../billing/upgrade-prompt";
import { day } from "../coach/context";
import { nameKey } from "../company-dossiers/company-names";
import type { CompanyDossiers, CompanyDossierState } from "../company-dossiers";
import type { EnrichedContacts, EnrichedContactsState } from "../enriched-contacts";
import type { ProfileSummary, Profiles } from "../profiles";
import { routes } from "../routes";
import type { TargetCompanies, TargetCompanyOnProfile } from "../target-companies";
import { contactQuota } from "./employer";
import { defineCoachAction, type ApplyProposalResult, type CoachAction, type CoachActionCall, type CoachActionResult, type ProposedChange } from "./index";
import type { WeeklyQuotaUse } from "./quota";
import { fittedLines, type CoachObjectReader, type ReadObject } from "./reads";

/** What `read_target_companies` reads, each scoped to the Candidate (./candidate-objects). */
export interface TargetCompanyReadSources {
  profiles: Pick<Profiles, "list">;
  targetCompanies: Pick<TargetCompanies, "onProfile">;
  companyDossiers: Pick<CompanyDossiers, "get">;
  enrichedContacts: Pick<EnrichedContacts, "get">;
}

/** The domain modules these Coach Actions go through, each scoped to the Candidate. */
export interface TargetCompanyActionSources {
  profiles: Pick<Profiles, "list">;
  targetCompanies: Pick<TargetCompanies, "onProfile" | "resolve" | "add" | "prepareSpontaneousApplication">;
  companyDossiers: Pick<CompanyDossiers, "get">;
  enrichedContacts: Pick<EnrichedContacts, "get" | "find" | "availability">;
  /** The week's Plan Quota of Enriched Contacts: what is used, the limit (null: unlimited) and the refusal without room. */
  enrichedContactQuota(candidateId: string): Promise<WeeklyQuotaUse>;
}

export const TARGET_COMPANY_ACTIONS = {
  read: "read_target_companies",
  add: "propose_target_company",
  dossier: "propose_target_company_dossier",
  contacts: "propose_target_contact_search",
  spontaneous: "propose_spontaneous_application",
} as const;

const id = z.string().min(1).max(200);
const NOT_FOUND = { ok: false, error: "not_found" } as const;
const CONFLICT = { ok: false, error: "conflict" } as const;

/** A proposing Coach Action's answer when there is nothing to propose: the AI Coach is told why, no card is made. */
const told = (message: string): CoachActionResult => ({ ok: true, proposes: false, data: { message } });

const longDate = (language: "fr" | "en", date: Date) => new Intl.DateTimeFormat(language === "en" ? "en-GB" : "fr-FR", { dateStyle: "long", timeZone: "Europe/Paris" }).format(date);

/** A Target Company's dossier version: when it was built, else what it lacks; a build, or its Spontaneous Application prepared, moves it. */
const dossierVersion = (state: CompanyDossierState | null) => (!state ? "none:no_application" : state.status === "built" ? state.dossier.builtAt.toISOString() : `none:${state.status}`);

/** A failure the Candidate's card says as « La proposition n'a pas pu être traitée » (the provider did not answer). */
class TargetCompanyActionFailed extends Error {
  override name = "TargetCompanyActionFailed";
}

const plural = (count: number, one: string, other: string) => `${count} ${count > 1 ? other : one}`;

/** A Target Company's dossier, as `read_target_companies` tells it. */
function dossierLine(state: CompanyDossierState | null): string {
  switch (state?.status) {
    case "built":
      return `dossier entreprise constitué le ${day(state.dossier.builtAt)}`;
    case "awaiting_confirmation":
    case "employer_unknown":
      return "dossier entreprise en attente de l'employeur à nommer ou confirmer (propose_dossier_employer)";
    default:
      return "dossier entreprise non constitué";
  }
}

/** Its contacts, as `read_target_companies` tells them: how many, never who nor their details. */
function contactsLine(state: EnrichedContactsState | null): string {
  if (!state) return "";
  if (!state.enabled || !state.searchable) return "recherche de contacts indisponible";
  if (state.found.length + state.contacts.length === 0) return "aucune personne trouvée";
  return [plural(state.found.length, "personne trouvée", "personnes trouvées"), plural(state.contacts.length, "contact révélé", "contacts révélés")].join(", ");
}

/**
 * The read of a Profile's Target Companies (`target_companies`, by the Profile's id), as the reads find it: null for an
 * Archived Profile, another Candidate's or an unknown id. Company names come from La Bonne Boite or the company register:
 * text the Candidate did not write (`untrusted`).
 */
export function targetCompaniesRead(sources: TargetCompanyReadSources) {
  return async (candidateId: string, profileId: string, maxTokens: number): Promise<ReadObject | null> => {
    const profile = (await sources.profiles.list(candidateId)).find((each) => each.id === profileId && !each.archived);
    const companies = profile ? await sources.targetCompanies.onProfile(candidateId, profile.id) : null;
    if (!profile || !companies) return null;
    const page = routes.profileSection(profile.id, "entreprises-cibles");
    const seen: SeenName = { type: "profile", name: profile.name.trim().slice(0, 80) || "—", href: page };
    const head = `Entreprises cibles du profil « ${profile.name} » (id ${profile.id}), celles que le candidat a ajoutées d'abord. Le dossier entreprise et les contacts d'une entreprise cible sont ceux de sa candidature spontanée.`;
    if (companies.length === 0)
      return { text: `${head}\nAucune entreprise cible : pour en ajouter une, propose propose_target_company.`, pages: [page], untrusted: false, seen };
    const lines = await Promise.all(
      companies.map(async (company) => {
        const application = company.spontaneousApplicationId;
        const [dossier, contacts] = application
          ? await Promise.all([sources.companyDossiers.get(candidateId, application), sources.enrichedContacts.get(candidateId, application)])
          : [null, null];
        return [
          `- entreprise cible (id ${company.id}) ${company.name}`,
          company.origin === "candidate" ? "ajoutée par le candidat" : `La Bonne Boite${company.hiringScore === null ? "" : `, potentiel d'embauche ${Math.round(company.hiringScore)}/100`}`,
          company.city,
          company.activity,
          application ? `candidature spontanée (id ${application}) · ${dossierLine(dossier)}` : "aucune candidature spontanée : aucun dossier entreprise",
          contactsLine(contacts),
        ]
          .filter(Boolean)
          .join(" · ");
      }),
    );
    const text = fittedLines(head, lines, maxTokens, (count) => `(${count} autres entreprises cibles ne sont pas montrées.)`);
    return { text, pages: [page], untrusted: true, seen };
  };
}

export function targetCompanyCoachActions(reader: CoachObjectReader, sources: TargetCompanyActionSources): CoachAction[] {
  /**
   * The Profile the call is about: the one named, else the one In view, else the Candidate's only active one; told which
   * ones there are when none can be told; `not_found` for an Archived Profile, another Candidate's or an unknown id.
   */
  async function profileOf(named: string | undefined, call: CoachActionCall): Promise<ProfileSummary | CoachActionResult> {
    const active = (await sources.profiles.list(call.candidateId)).filter((profile) => !profile.archived);
    const wanted = named ?? (call.inView?.kind === "profile" ? call.inView.id : undefined);
    if (wanted) return active.find((profile) => profile.id === wanted) ?? NOT_FOUND;
    if (active.length === 1) return active[0]!;
    if (active.length === 0) return told("Le candidat n'a aucun profil actif : les entreprises cibles sont celles d'un profil. Il en crée un depuis « Créer un profil » (renvoi profile_create).");
    return told(`De quel profil s'agit-il ? Précise profileId parmi ses profils actifs : ${active.map((profile) => `« ${profile.name} » (id ${profile.id})`).join(", ")}.`);
  }
  const isProfile = (value: ProfileSummary | CoachActionResult): value is ProfileSummary => "name" in value && "archived" in value;

  /** The Profile and its Target Company `targetCompanyId`, as its page shows it; else what to answer. */
  async function targetOf(
    profileId: string | undefined,
    targetCompanyId: string,
    call: CoachActionCall,
  ): Promise<{ answer: CoachActionResult } | { profile: ProfileSummary; company: TargetCompanyOnProfile }> {
    const profile = await profileOf(profileId, call);
    if (!isProfile(profile)) return { answer: profile };
    const company = (await sources.targetCompanies.onProfile(call.candidateId, profile.id))?.find((each) => each.id === targetCompanyId);
    if (!company) return { answer: NOT_FOUND };
    return { profile, company };
  }

  /** The Candidate's active Profile `profileId` and its Target Company `targetCompanyId` now: null when either is gone. */
  async function stillThere(candidateId: string, profileId: string, targetCompanyId: string | undefined) {
    if (!targetCompanyId) return null;
    const active = (await sources.profiles.list(candidateId)).some((profile) => profile.id === profileId && !profile.archived);
    return active ? ((await sources.targetCompanies.onProfile(candidateId, profileId))?.find((each) => each.id === targetCompanyId) ?? null) : null;
  }

  const onProfile = (profile: ProfileSummary, language: "fr" | "en"): ProposedChange["target"] => ({
    kind: "profile",
    id: profile.id,
    name: createI18n(language).t("coachProposals.profileName", { name: profile.name }),
    href: routes.profileSection(profile.id, "entreprises-cibles"),
  });

  /** Its Spontaneous Application's Company Dossier: null when it has none yet. */
  const dossierOf = async (candidateId: string, company: TargetCompanyOnProfile) =>
    company.spontaneousApplicationId ? sources.companyDossiers.get(candidateId, company.spontaneousApplicationId) : null;

  const read = defineCoachAction({
    name: TARGET_COMPANY_ACTIONS.read,
    description:
      "Lit les entreprises cibles d'un profil actif du candidat (celles qu'il a ajoutées et celles de La Bonne Boite) : pour chacune son id, sa ville, sa candidature spontanée, son dossier entreprise (constitué ou non) et combien de contacts sont trouvés et révélés. Sers-t'en pour une entreprise chez qui le candidat n'a aucune candidature, avant de proposer quoi que ce soit sur elle. profileId : omis, le profil consulté ou son seul profil actif.",
    schema: z.object({ profileId: id.optional() }),
    group: "profile",
    kind: "read",
    copiesText: false,
    async run({ profileId }, call) {
      // The Profile named or In view is the reader's to scope (an Eval Case's fictional objects have no domain behind them).
      let wanted = profileId ?? (call.inView?.kind === "profile" ? call.inView.id : undefined);
      if (!wanted) {
        const profile = await profileOf(undefined, call);
        if (!isProfile(profile)) return profile;
        wanted = profile.id;
      }
      const found = await reader.read(call.candidateId, "target_companies", wanted, call.maxTokens ?? Number.POSITIVE_INFINITY);
      return found ? { ok: true, data: found.text, pages: found.pages, untrusted: found.untrusted, ...(found.seen ? { seen: [found.seen] } : {}) } : NOT_FOUND;
    },
  });

  const add = defineCoachAction({
    name: TARGET_COMPANY_ACTIONS.add,
    description:
      "Propose d'ajouter une entreprise aux entreprises cibles d'un profil du candidat, quand il parle d'une entreprise chez qui il n'a aucune candidature (des contacts, un dossier, postuler) et qu'elle n'y est pas encore : name, le nom de l'entreprise (ou son SIREN) tel qu'il le donne. La carte nomme le profil et l'entreprise telle que le registre des entreprises la connaît ; le candidat peut corriger le nom avant d'appliquer. profileId : omis, le profil consulté ou son seul profil actif.",
    schema: z.object({ profileId: id.optional(), name: z.string().trim().min(1).max(200) }),
    group: "profile",
    kind: "propose",
    copiesText: true,
    sentByCandidate: true,
    async run({ profileId, name }, call) {
      const profile = await profileOf(profileId, call);
      if (!isProfile(profile)) return profile;
      const resolved = await sources.targetCompanies.resolve(name);
      if (!resolved.ok && resolved.error === "not_a_company")
        return {
          ok: false,
          error: "refused",
          reason: `« ${name} » n'est pas ajoutée aux entreprises cibles : d'après le registre des entreprises, c'est le nom d'un entrepreneur individuel, une personne et non une entreprise, et Jobbbox ne cherche jamais une personne. Dis-le au candidat en une phrase et demande-lui le nom de l'entreprise elle-même.`,
        };
      if (!resolved.ok) return told("Aucun nom d'entreprise : demande au candidat le nom de l'entreprise (ou son SIREN).");
      const companies = await sources.targetCompanies.onProfile(call.candidateId, profile.id);
      if (!companies) return NOT_FOUND;
      const existing = companies.find((each) => each.companyKey === resolved.companyKey || nameKey(each.name) === nameKey(resolved.name));
      if (existing)
        return told(
          `« ${existing.name} » est déjà une entreprise cible du profil « ${profile.name} » (id ${existing.id}) : propose ce que le candidat demande sur elle, son dossier entreprise avec propose_target_company_dossier, la recherche de contacts avec propose_target_contact_search ou une candidature spontanée avec propose_spontaneous_application.`,
        );
      const { t } = createI18n(call.language);
      const shown = resolved.siren ? t("coachProposals.values.registeredCompany", { name: resolved.name, siren: resolved.siren }) : resolved.name;
      const change: ProposedChange = {
        target: onProfile(profile, call.language),
        what: t("coachProposals.fields.targetCompany"),
        before: t("coachProposals.values.notTargetCompany", { profile: profile.name }),
        after: t("coachProposals.values.targetCompanyAdded", { company: shown, profile: profile.name }),
        value: { name: resolved.name },
        fields: [{ name: "name", label: t("coachProposals.fields.employerName"), type: "text" }],
        version: "absent",
      };
      return { ok: true, data: change, pages: [change.target.href] };
    },
    async apply(change, { candidateId }) {
      const active = (await sources.profiles.list(candidateId)).some((profile) => profile.id === change.target.id && !profile.archived);
      if (!active) return NOT_FOUND;
      // As the Section's own form adds it: the name the Candidate left in the form, resolved in the register again.
      const added = await sources.targetCompanies.add(candidateId, change.target.id, change.value.name ?? "");
      if (added.ok) return { ok: true };
      // Added since (or set aside): not a company the Candidate can add again.
      if (added.error === "exists") return CONFLICT;
      return { ok: false, error: "invalid", errors: [{ field: "name", code: "invalid" }] };
    },
  });

  const dossier = defineCoachAction({
    name: TARGET_COMPANY_ACTIONS.dossier,
    description:
      "Propose de constituer ou de mettre à jour le dossier entreprise d'une entreprise cible d'un profil du candidat (identité, chiffres, fonctions à contacter, actualités), quand il le demande ou qu'il manque pour lui répondre (des contacts, une candidature spontanée). targetCompanyId : son id, lu avec read_target_companies. Le candidat le lance lui-même sous ta réponse (« Mettre à jour ») ; sa candidature spontanée est préparée d'abord s'il n'en a pas. Tu n'écris jamais le contenu du dossier. profileId : omis, le profil consulté ou son seul profil actif.",
    schema: z.object({ profileId: id.optional(), targetCompanyId: id }),
    group: "profile",
    kind: "propose",
    copiesText: false,
    async run({ profileId, targetCompanyId }, call) {
      const found = await targetOf(profileId, targetCompanyId, call);
      if ("answer" in found) return found.answer;
      const { profile, company } = found;
      const application = company.spontaneousApplicationId;
      const state = await dossierOf(call.candidateId, company);
      if (application && !state) return NOT_FOUND;
      if (state?.status === "employer_unknown" || state?.status === "awaiting_confirmation")
        return told(`Le dossier entreprise de « ${company.name} » attend que son employeur soit nommé ou confirmé : propose-le avec propose_dossier_employer, applicationId ${application}.`);
      const { t } = createI18n(call.language);
      const target = onProfile(profile, call.language);
      const change: ProposedChange = {
        target,
        what: t("coachProposals.fields.targetCompanyDossier", { company: company.name }),
        before: state?.status === "built" ? t("coachProposals.values.dossierOf", { date: longDate(call.language, state.dossier.builtAt) }) : t("coachProposals.values.noDossier"),
        after: t("coachProposals.values.dossierRebuilt"),
        // Applying it prepares the Spontaneous Application where the dossier is built: said on the same card.
        ...(application
          ? {}
          : {
              also: [
                {
                  what: t("coachProposals.fields.spontaneousApplication"),
                  before: t("coachProposals.values.noSpontaneousApplication"),
                  after: t("coachProposals.values.spontaneousApplicationPrepared", { company: company.name }),
                },
              ],
            }),
        value: { targetCompanyId: company.id },
        fields: [],
        version: dossierVersion(state),
        quota: { label: t("coachProposals.quota.companyDossier") },
        launches: true,
        runs: {
          kind: "company_dossier",
          url: `/api/profiles/${encodeURIComponent(profile.id)}/target-companies/${encodeURIComponent(company.id)}/company-dossier`,
          body: {},
          opens: application ? routes.applicationSection(application, "dossier") : target.href,
        },
      };
      return { ok: true, data: change, pages: [target.href] };
    },
    async apply(change, { candidateId }) {
      const company = await stillThere(candidateId, change.target.id, change.value.targetCompanyId);
      if (!company) return NOT_FOUND;
      // Built, or its Spontaneous Application prepared, since the card was made: not the dossier the Candidate chose to build.
      return dossierVersion(await dossierOf(candidateId, company)) === change.version ? { ok: true } : CONFLICT;
    },
  });

  const contacts = defineCoachAction({
    name: TARGET_COMPANY_ACTIONS.contacts,
    description:
      "Propose de rechercher des contacts chez une entreprise cible d'un profil du candidat (offre Premium), quand il le demande : les personnes qui occupent les fonctions à contacter de son dossier entreprise, sans leurs coordonnées. targetCompanyId : son id, lu avec read_target_companies. Il faut son dossier entreprise constitué : sinon propose d'abord propose_target_company_dossier. La recherche ne compte pas ; la carte dit le quota de contacts enrichis de la semaine. profileId : omis, le profil consulté ou son seul profil actif.",
    schema: z.object({ profileId: id.optional(), targetCompanyId: id }),
    group: "profile",
    kind: "propose",
    copiesText: false,
    async run({ profileId, targetCompanyId }, call) {
      const found = await targetOf(profileId, targetCompanyId, call);
      if ("answer" in found) return found.answer;
      const { profile, company } = found;
      const application = company.spontaneousApplicationId;
      const { enabled, searchable } = sources.enrichedContacts.availability();
      if (!enabled || !searchable)
        return {
          ok: false,
          error: "refused",
          reason: `La recherche de contacts est indisponible sur Jobbbox en ce moment (aucun service de contacts n'est actif) : ne la propose pas. Dis-le au candidat en une phrase ; son dossier entreprise dit les fonctions à contacter chez « ${company.name} ».`,
          redirect: { target: "company_dossier", profileId: profile.id, ...(application ? { applicationId: application } : {}) },
        };
      const quota = await sources.enrichedContactQuota(call.candidateId);
      if (quota.refusal && quota.limit === 0) {
        const upgrade = quota.refusal.upgradeToName ? `, que l'offre ${quota.refusal.upgradeToName.fr} inclut` : "";
        return {
          ok: false,
          error: "refused",
          reason: `La recherche de contacts n'est pas proposée : l'offre ${quota.refusal.planName.fr} du candidat n'inclut pas les contacts enrichis${upgrade}. Dis-le-lui en une phrase ; tu ne changes jamais d'offre à sa place.`,
          redirect: { target: "plan" },
        };
      }
      const state = application ? await sources.enrichedContacts.get(call.candidateId, application) : null;
      const built = await dossierOf(call.candidateId, company);
      if (application && (!state || !built)) return NOT_FOUND;
      if (!application || !state || built?.status !== "built")
        return told(`Le dossier entreprise de « ${company.name} » n'est pas constitué : les contacts se cherchent à partir de ses fonctions à contacter. Propose d'abord propose_target_company_dossier (targetCompanyId ${company.id}).`);
      const { t } = createI18n(call.language);
      const people = state.found.length + state.contacts.length;
      const change: ProposedChange = {
        target: { kind: "application", id: application, name: company.name, href: routes.applicationSection(application, "contacts") },
        what: t("coachProposals.fields.contactSearch"),
        before: people ? t("coachProposals.values.peopleFound", { count: people }) : t("coachProposals.values.noPeople"),
        after: t("coachProposals.values.peopleAt", { employer: built.dossier.employer }),
        value: { targetCompanyId: company.id, profileId: profile.id },
        fields: [],
        version: String(people),
        quota: await contactQuota(sources, t, call, false),
      };
      return { ok: true, data: change, pages: [change.target.href] };
    },
    async apply(change, { candidateId, language }) {
      const company = await stillThere(candidateId, change.value.profileId ?? "", change.value.targetCompanyId);
      if (!company || company.spontaneousApplicationId !== change.target.id) return NOT_FOUND;
      return contactsApplied(await sources.enrichedContacts.find(candidateId, change.target.id), language ?? "fr");
    },
  });

  const spontaneous = defineCoachAction({
    name: TARGET_COMPANY_ACTIONS.spontaneous,
    description:
      "Propose de préparer une candidature spontanée chez une entreprise cible d'un profil du candidat, quand il veut y postuler sans offre publiée : une candidature « À postuler » pour le poste du profil, où se préparent son dossier entreprise, ses contacts et ses documents. targetCompanyId : son id, lu avec read_target_companies. profileId : omis, le profil consulté ou son seul profil actif.",
    schema: z.object({ profileId: id.optional(), targetCompanyId: id }),
    group: "profile",
    kind: "propose",
    copiesText: false,
    async run({ profileId, targetCompanyId }, call) {
      const found = await targetOf(profileId, targetCompanyId, call);
      if ("answer" in found) return found.answer;
      const { profile, company } = found;
      if (company.spontaneousApplicationId)
        return told(
          `La candidature spontanée chez « ${company.name} » est déjà préparée (applicationId ${company.spontaneousApplicationId}) : propose ses documents (CV adapté, lettre de motivation, message d'approche) sur cette candidature.`,
        );
      const { t } = createI18n(call.language);
      const change: ProposedChange = {
        target: onProfile(profile, call.language),
        what: t("coachProposals.fields.spontaneousApplication"),
        before: t("coachProposals.values.noSpontaneousApplication"),
        after: t("coachProposals.values.spontaneousApplicationPrepared", { company: company.name }),
        value: { targetCompanyId: company.id },
        fields: [],
        version: "none",
      };
      return { ok: true, data: change, pages: [change.target.href] };
    },
    async apply(change, { candidateId }) {
      if (!change.value.targetCompanyId || !(await stillThere(candidateId, change.target.id, change.value.targetCompanyId))) return NOT_FOUND;
      // Prepared since: the same one, nothing added.
      const prepared = await sources.targetCompanies.prepareSpontaneousApplication(candidateId, change.target.id, change.value.targetCompanyId);
      return prepared.ok ? { ok: true } : NOT_FOUND;
    },
  });

  return [read, add, dossier, contacts, spontaneous];
}

/** What « Appliquer » gets back from the Enriched Contacts module, as a card's outcome. */
function contactsApplied(result: Awaited<ReturnType<EnrichedContacts["find"]>>, language: "fr" | "en"): ApplyProposalResult {
  if (result.ok) return { ok: true };
  if (result.error === "quota_exceeded") return { ok: false, error: "quota", prompt: upgradePrompt(result.refusal, language) };
  if (result.error === "not_found") return NOT_FOUND;
  throw new TargetCompanyActionFailed(result.error);
}
