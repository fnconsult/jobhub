/**
 * The employer's side of an Application, as the AI Coach proposes it (ADR-0114): its Company Dossier and its Enriched
 * Contacts, each an Action Card applied by the Candidate through the module its Section's route calls. The AI Coach reads
 * them with read_company_dossier and read_enriched_contacts (./reads); it never writes the dossier's content, and an
 * Enriched Contact's email or phone never reaches it, on a card or in what it is told.
 *  - `propose_company_dossier_rebuild`: « Mettre à jour » runs the dossier's build through its route, live on the card
 *    beside « Arrêter » (`runs`), then opens the Dossier Section; its card says the Plan Quota it uses (none: a dossier
 *    counts against no Plan Quota). Launched from the dossier seen (rebuilt since: a conflict). Not while the employer is
 *    to be named or confirmed: that is `propose_dossier_employer`.
 *  - `propose_dossier_employer`: confirms or corrects the employer (the Presumed Employer of an agency's posting, or the
 *    one an offer does not name), with the dossier's form; « Appliquer » names the employer the form holds, and the dossier
 *    is built for it (`confirmEmployer`). Its name is read in full on the form and applied by the Candidate: offered with
 *    an Application In view (`sentByCandidate`), like a draft.
 *  - `propose_contact_search`, `propose_contact_reveal` (Premium): find people holding the dossier's Suggested Contact
 *    Roles (not counted), or reveal one found (one Enriched Contact of the week's Plan Quota); each card says the Plan Quota,
 *    or shows the Upgrade prompt in place of its buttons on a Plan without room, as « Appliquer » does when the room went
 *    since.
 * None undoes: a dossier built or a contact revealed stays (« Annuler » has nothing to put back). Each is scoped to the
 * session's Candidate: another's id, an Archived Application (its Profile archived) or an unknown id is `not_found`.
 *
 *   employerCoachActions({ applications, profiles, companyDossiers, enrichedContacts, enrichedContactQuota })
 */
import { createI18n } from "@jobhub/shared/i18n";
import * as z from "zod";
import type { Application, Applications } from "../applications";
import { upgradePrompt, type UpgradePrompt } from "../billing/upgrade-prompt";
import type { CompanyDossiers, CompanyDossierState } from "../company-dossiers";
import type { EnrichedContacts } from "../enriched-contacts";
import type { Profiles } from "../profiles";
import { routes } from "../routes";
import { defineCoachAction, type ApplyProposalResult, type CoachAction, type CoachActionCall, type CoachActionResult, type ProposedChange } from "./index";
import type { WeeklyQuotaUse } from "./quota";

type Translate = ReturnType<typeof createI18n>["t"];

/** The domain modules these Coach Actions go through, each scoped to the Candidate. */
export interface EmployerActionSources {
  applications: Pick<Applications, "get">;
  profiles: Pick<Profiles, "list">;
  companyDossiers: Pick<CompanyDossiers, "get" | "confirmEmployer">;
  enrichedContacts: Pick<EnrichedContacts, "get" | "find" | "reveal">;
  /** The week's Plan Quota of Enriched Contacts: what is used, the limit (null: unlimited) and the refusal without room. */
  enrichedContactQuota(candidateId: string): Promise<WeeklyQuotaUse>;
}

export const EMPLOYER_ACTIONS = {
  rebuild: "propose_company_dossier_rebuild",
  employer: "propose_dossier_employer",
  search: "propose_contact_search",
  reveal: "propose_contact_reveal",
} as const;

const id = z.string().min(1).max(200);
const NOT_FOUND = { ok: false, error: "not_found" } as const;
const CONFLICT = { ok: false, error: "conflict" } as const;
/** The version of a dossier not built. */
const NO_DOSSIER = "none";

/** A proposing Coach Action's answer when there is nothing to propose: the AI Coach is told why, no card is made. */
const told = (message: string): CoachActionResult => ({ ok: true, proposes: false, data: { message } });

const WHICH_APPLICATION = told("Aucune candidature n'est consultée : demande au candidat de quelle candidature il s'agit, ou précise-la (applicationId, lu dans l'index de ses objets).");

/** A failure the Candidate's card says as « La proposition n'a pas pu être traitée » (the provider or the register did not answer). */
class EmployerActionFailed extends Error {
  override name = "EmployerActionFailed";
}

const nameOf = (application: Application) => [application.jobOffer.title, application.jobOffer.employer].filter(Boolean).join(" · ");
const longDate = (language: "fr" | "en", date: Date) => new Intl.DateTimeFormat(language === "en" ? "en-GB" : "fr-FR", { dateStyle: "long", timeZone: "Europe/Paris" }).format(date);
const folded = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();

/** A dossier's version: when it was built, or NO_DOSSIER; a rebuild moves it. */
const dossierVersion = (state: CompanyDossierState) => (state.status === "built" ? state.dossier.builtAt.toISOString() : `${NO_DOSSIER}:${state.status}`);

/** The employer a dossier is about now: the one it was built for, or the Presumed Employer; null when none is named. */
function employerOf(state: CompanyDossierState): { name: string; presumed: boolean } | null {
  if (state.status === "built") return { name: state.dossier.employer, presumed: false };
  if (state.status === "awaiting_confirmation" && state.presumedEmployer) return { name: state.presumedEmployer, presumed: true };
  return null;
}

/**
 * The Enriched Contacts' Plan Quota as a card says it: the search (not counted) or a reveal (one counted), or the Upgrade
 * prompt without room. A Target Company's contact search says it the same way (./target-companies).
 */
export async function contactQuota(sources: Pick<EmployerActionSources, "enrichedContactQuota">, t: Translate, call: CoachActionCall, counted: boolean): Promise<{ label: string; prompt?: UpgradePrompt }> {
  const { used, limit, refusal } = await sources.enrichedContactQuota(call.candidateId);
  if (refusal) return { label: t(limit === 0 ? "coachProposals.quota.contactsNotIncluded" : "coachProposals.quota.contactsNone", { limit }), prompt: upgradePrompt(refusal, call.language) };
  if (limit === null) return { label: t(counted ? "coachProposals.quota.contactRevealUnlimited" : "coachProposals.quota.contactSearchUnlimited") };
  return counted
    ? { label: t("coachProposals.quota.contactReveal", { limit, left: Math.max(0, limit - used - 1) }) }
    : { label: t("coachProposals.quota.contactSearch", { limit, left: Math.max(0, limit - used) }) };
}

export function employerCoachActions(sources: EmployerActionSources): CoachAction[] {
  /** The Candidate's Application `applicationId`, unless it is an Archived Application (its Profile archived): out of reach. */
  async function reachable(candidateId: string, applicationId: string): Promise<Application | null> {
    const [application, profiles] = await Promise.all([sources.applications.get(candidateId, applicationId), sources.profiles.list(candidateId)]);
    return application && profiles.some((profile) => profile.id === application.profile.id && !profile.archived) ? application : null;
  }

  /** The Application the call is about: the one named, else the one In view; undefined when there is neither. */
  const applicationIdOf = (named: string | undefined, call: CoachActionCall) => named ?? (call.inView?.kind === "application" ? call.inView.id : undefined);

  const targetOf = (application: Application, section: "dossier" | "contacts"): ProposedChange["target"] => ({
    kind: "application",
    id: application.id,
    name: nameOf(application),
    href: routes.applicationSection(application.id, section),
  });

  /** What « Appliquer » gets back from the Enriched Contacts module, as a card's outcome. */
  const contactsApplied = (result: Awaited<ReturnType<EnrichedContacts["find"]>>, language: "fr" | "en"): ApplyProposalResult => {
    if (result.ok) return { ok: true };
    if (result.error === "quota_exceeded") return { ok: false, error: "quota", prompt: upgradePrompt(result.refusal, language) };
    if (result.error === "not_found") return NOT_FOUND;
    throw new EmployerActionFailed(result.error);
  };

  const rebuild = defineCoachAction({
    name: EMPLOYER_ACTIONS.rebuild,
    description:
      "Propose de constituer ou de mettre à jour le dossier entreprise d'une candidature du candidat (identité, chiffres, fonctions à contacter, actualités de l'employeur), quand il le demande ou que le dossier manque pour lui répondre. Le candidat le lance lui-même sous ta réponse (« Mettre à jour ») ; la carte dit le quota qu'il utilise. Tu n'écris jamais le contenu du dossier : seule cette mise à jour le change. applicationId : omis, la candidature consultée.",
    schema: z.object({ applicationId: id.optional() }),
    group: "applications",
    kind: "propose",
    copiesText: false,
    async run({ applicationId }, call) {
      const wanted = applicationIdOf(applicationId, call);
      if (!wanted) return WHICH_APPLICATION;
      const application = await reachable(call.candidateId, wanted);
      const state = application ? await sources.companyDossiers.get(call.candidateId, application.id) : null;
      if (!application || !state) return NOT_FOUND;
      if (state.status === "employer_unknown" || state.status === "awaiting_confirmation")
        return told("L'employeur de cette candidature est à nommer ou à confirmer avant de constituer son dossier : propose-le avec propose_dossier_employer.");
      const { t } = createI18n(call.language);
      const href = routes.applicationSection(application.id, "dossier");
      const change: ProposedChange = {
        target: targetOf(application, "dossier"),
        what: t("coachProposals.fields.companyDossier"),
        before: state.status === "built" ? t("coachProposals.values.dossierOf", { date: longDate(call.language, state.dossier.builtAt) }) : t("coachProposals.values.noDossier"),
        after: t("coachProposals.values.dossierRebuilt"),
        value: {},
        fields: [],
        version: dossierVersion(state),
        quota: { label: t("coachProposals.quota.companyDossier") },
        launches: true,
        runs: { kind: "company_dossier", url: `/api/applications/${encodeURIComponent(application.id)}/company-dossier`, body: {}, opens: href },
      };
      return { ok: true, data: change, pages: [href] };
    },
    async apply(change, { candidateId }) {
      const application = await reachable(candidateId, change.target.id);
      const state = application ? await sources.companyDossiers.get(candidateId, application.id) : null;
      if (!state) return NOT_FOUND;
      // Rebuilt or confirmed since the card was made: not the dossier the Candidate chose to update.
      return dossierVersion(state) === change.version ? { ok: true } : CONFLICT;
    },
  });

  const employer = defineCoachAction({
    name: EMPLOYER_ACTIONS.employer,
    description:
      "Propose de confirmer ou de corriger l'employeur d'une candidature du candidat, quand l'offre vient d'un cabinet (employeur présumé) ou ne le nomme pas, ou que le candidat dit que ce n'est pas le bon : employer, le nom de l'entreprise (ou son SIREN), tel que le candidat le donne ou le confirme. Le candidat le relit dans un formulaire et l'applique ; son dossier entreprise est alors constitué pour cet employeur. applicationId : omis, la candidature consultée.",
    schema: z.object({ applicationId: id.optional(), employer: z.string().trim().min(1).max(200) }),
    group: "applications",
    kind: "propose",
    copiesText: true,
    sentByCandidate: true,
    async run({ applicationId, employer: named }, call) {
      const wanted = applicationIdOf(applicationId, call);
      if (!wanted) return WHICH_APPLICATION;
      const application = await reachable(call.candidateId, wanted);
      const state = application ? await sources.companyDossiers.get(call.candidateId, application.id) : null;
      if (!application || !state) return NOT_FOUND;
      const current = employerOf(state);
      if (current && !current.presumed && folded(current.name) === folded(named)) return told(`Le dossier entreprise est déjà celui de « ${current.name} » : rien à proposer.`);
      const { t } = createI18n(call.language);
      const href = routes.applicationSection(application.id, "dossier");
      const change: ProposedChange = {
        target: targetOf(application, "dossier"),
        what: t("coachProposals.fields.dossierEmployer"),
        before: current ? (current.presumed ? t("coachProposals.values.presumedEmployer", { employer: current.name }) : current.name) : t("coachProposals.values.employerUnknown"),
        after: named,
        value: { employer: named },
        fields: [{ name: "employer", label: t("coachProposals.fields.employerName"), type: "text" }],
        version: dossierVersion(state),
      };
      return { ok: true, data: change, pages: [href] };
    },
    async apply(change, { candidateId }) {
      const application = await reachable(candidateId, change.target.id);
      if (!application) return NOT_FOUND;
      // Built for the employer the form holds, as the Dossier Section's own form builds it.
      const confirmed = await sources.companyDossiers.confirmEmployer(candidateId, application.id, { employer: change.value.employer ?? "" });
      if (confirmed.ok) return { ok: true };
      if ("errors" in confirmed) return { ok: false, error: "invalid", errors: confirmed.errors.map((error) => ({ field: error.field, code: error.code === "not_a_company" ? "invalid" : error.code })) };
      if (confirmed.error === "not_found") return NOT_FOUND;
      throw new EmployerActionFailed(confirmed.error);
    },
  });

  const search = defineCoachAction({
    name: EMPLOYER_ACTIONS.search,
    description:
      "Propose de rechercher des contacts chez l'employeur d'une candidature du candidat (offre Premium), quand il le demande : les personnes qui occupent les fonctions à contacter du dossier entreprise, sans leurs coordonnées. La recherche ne compte pas ; la carte dit le quota de contacts enrichis de la semaine, ou propose de changer d'offre. applicationId : omis, la candidature consultée.",
    schema: z.object({ applicationId: id.optional() }),
    group: "applications",
    kind: "propose",
    copiesText: false,
    async run({ applicationId }, call) {
      const wanted = applicationIdOf(applicationId, call);
      if (!wanted) return WHICH_APPLICATION;
      const application = await reachable(call.candidateId, wanted);
      const [state, dossier] = application ? await Promise.all([sources.enrichedContacts.get(call.candidateId, application.id), sources.companyDossiers.get(call.candidateId, application.id)]) : [null, null];
      if (!application || !state || !dossier) return NOT_FOUND;
      if (!state.enabled || !state.searchable) return told("La recherche de contacts n'est pas disponible sur Jobbbox en ce moment : ne la propose pas.");
      if (dossier.status !== "built") return told("Le dossier entreprise de cette candidature n'est pas constitué : les contacts se cherchent à partir de lui. Propose d'abord propose_company_dossier_rebuild.");
      const { t } = createI18n(call.language);
      const href = routes.applicationSection(application.id, "contacts");
      const people = state.found.length + state.contacts.length;
      const change: ProposedChange = {
        target: targetOf(application, "contacts"),
        what: t("coachProposals.fields.contactSearch"),
        before: people ? t("coachProposals.values.peopleFound", { count: people }) : t("coachProposals.values.noPeople"),
        after: t("coachProposals.values.peopleAt", { employer: dossier.dossier.employer }),
        value: {},
        fields: [],
        version: String(people),
        quota: await contactQuota(sources, t, call, false),
      };
      return { ok: true, data: change, pages: [href] };
    },
    async apply(change, { candidateId, language }) {
      if (!(await reachable(candidateId, change.target.id))) return NOT_FOUND;
      return contactsApplied(await sources.enrichedContacts.find(candidateId, change.target.id), language ?? "fr");
    },
  });

  const reveal = defineCoachAction({
    name: EMPLOYER_ACTIONS.reveal,
    description:
      "Propose de révéler les coordonnées d'une personne trouvée chez l'employeur d'une candidature du candidat (offre Premium), quand il le demande : contactId, l'id d'un contact trouvé mais pas encore révélé (lu avec read_enriched_contacts). Chaque révélation compte un contact enrichi du quota de la semaine : la carte le dit, ou propose de changer d'offre. Tu ne lis jamais ses coordonnées : le candidat les lit dans Contacts. applicationId : omis, la candidature consultée.",
    schema: z.object({ applicationId: id.optional(), contactId: id }),
    group: "applications",
    kind: "propose",
    copiesText: false,
    async run({ applicationId, contactId }, call) {
      const wanted = applicationIdOf(applicationId, call);
      if (!wanted) return WHICH_APPLICATION;
      const application = await reachable(call.candidateId, wanted);
      const state = application ? await sources.enrichedContacts.get(call.candidateId, application.id) : null;
      if (!application || !state) return NOT_FOUND;
      const revealed = state.contacts.find((contact) => contact.id === contactId);
      if (revealed) return told(`${revealed.name} est déjà révélé : ses coordonnées sont dans Contacts. Pour lui écrire, propose propose_outreach_message avec son contactId.`);
      const person = state.found.find((each) => each.id === contactId);
      if (!person) return NOT_FOUND;
      if (!state.enabled) return told("Les contacts enrichis ne sont pas disponibles sur Jobbbox en ce moment : ne propose pas de révélation.");
      const { t } = createI18n(call.language);
      const href = routes.applicationSection(application.id, "contacts");
      const change: ProposedChange = {
        target: targetOf(application, "contacts"),
        what: t("coachProposals.fields.enrichedContact"),
        before: t("coachProposals.values.personFound", { person: person.jobTitle ? `${person.name}, ${person.jobTitle}` : person.name }),
        after: t("coachProposals.values.personRevealed"),
        value: { contactId: person.id },
        fields: [],
        version: "found",
        quota: await contactQuota(sources, t, call, true),
      };
      return { ok: true, data: change, pages: [href] };
    },
    async apply(change, { candidateId, language }) {
      const contactId = change.value.contactId;
      if (!contactId || !(await reachable(candidateId, change.target.id))) return NOT_FOUND;
      // Revealed since: revealing again costs nothing and changes nothing.
      return contactsApplied(await sources.enrichedContacts.reveal(candidateId, change.target.id, contactId), language ?? "fr");
    },
  });

  return [rebuild, employer, search, reveal];
}
