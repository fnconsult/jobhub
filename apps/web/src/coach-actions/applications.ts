/**
 * The Candidatures Coach Actions (#716, ADR-0077): what the AI Coach proposes on the Candidate's Applications, each an
 * Action Card under its reply that the Candidate applies, through the Applications module (and the Follow-ups module for
 * a Follow-up sent), the same validation as the pages' routes:
 *  - `propose_application`: save a Job Offer (the one In view, or one the reads reach) as an Application of an active
 *    Profile (the first one unless named). One per Job Offer: already saved, nothing is proposed and the AI Coach is told
 *    which Application it is, to link it. « Annuler » removes it while it is intact (nothing added to it since).
 *  - `propose_application_status`: a new Application Status, « Refusée » and « Abandonnée » included (which archive it).
 *  - `propose_application_profile`: another active Profile for the Application.
 *  - `propose_follow_up_sent`: a Follow-up marked as sent (« Relancée »), at most MAX_FOLLOW_UPS.
 * None copies text (`copiesText: false`): they stay offered while a Job Offer is In view. None deletes: asked to, the AI
 * Coach points to the Application's page. Each is scoped to the session's Candidate: another's id, an Archived Profile's
 * Application or an unknown id is `not_found`. Applied from the version seen (moved on since: a conflict); the object keeps
 * its Origin; « Annuler » puts the state before back while it has not moved on since.
 *
 *   applicationCoachActions({ applications, profiles, jobOffers, followUps, reachesJobOffer })
 */
import { APPLICATION_STATUSES, type ApplicationStatus } from "@jobhub/shared";
import { createI18n } from "@jobhub/shared/i18n";
import * as z from "zod";
import type { Application, ApplicationChangeResult, Applications } from "../applications";
import { MAX_FOLLOW_UPS, type FollowUps } from "../follow-ups";
import type { JobOffers } from "../job-offers";
import { readOrigin, type Origin } from "../origin";
import type { Profiles } from "../profiles";
import { routes } from "../routes";
import { defineCoachAction, type ApplyProposalResult, type CoachAction, type CoachActionCall, type CoachActionResult, type ProposalCall, type ProposedChange } from "./index";

/** The domain modules the Candidatures Coach Actions go through, each scoped to the Candidate. */
export interface ApplicationActionSources {
  applications: Pick<Applications, "save" | "get" | "list" | "statusOf" | "profileOf" | "change" | "removeIntact">;
  profiles: Pick<Profiles, "list">;
  jobOffers: Pick<JobOffers, "get">;
  followUps: Pick<FollowUps, "sentOf" | "markSent" | "unmarkSent">;
  /** Whether one of the Candidate's objects shows this Job Offer (an Application, a Job Search, a Job Digest): the reads' reach (#714). */
  reachesJobOffer(candidateId: string, jobOfferId: string): Promise<boolean>;
}

export const PROPOSE_APPLICATION = "propose_application";
export const PROPOSE_APPLICATION_STATUS = "propose_application_status";
export const PROPOSE_APPLICATION_PROFILE = "propose_application_profile";
export const PROPOSE_FOLLOW_UP_SENT = "propose_follow_up_sent";

const id = z.string().min(1).max(200);
const NOT_FOUND = { ok: false, error: "not_found" } as const;
const CONFLICT = { ok: false, error: "conflict" } as const;

/** A proposing Coach Action's answer when there is nothing to propose: the model is told why, no card is made. */
const told = (message: string, more: { applicationId?: string; href?: string } = {}): CoachActionResult => ({
  ok: true,
  proposes: false,
  data: { message, ...more },
  ...(more.href ? { pages: [more.href] } : {}),
});

const offerName = (jobOffer: { title: string; employer?: string | null }) => [jobOffer.title, jobOffer.employer].filter(Boolean).join(" · ");

/** A change the domain module refused, as « Appliquer » reports it. */
const refused = (changed: Exclude<ApplicationChangeResult, { ok: true }>): Exclude<ApplyProposalResult, { ok: true }> =>
  "errors" in changed ? { ok: false, error: "invalid", errors: changed.errors } : changed.error === "conflict" ? CONFLICT : NOT_FOUND;

const origin = ({ cardId, at }: ProposalCall): Origin => ({ origin: "coach_proposal", cardId, appliedAt: at });

/** The Application the call is about: the one named, else the one In view. */
const applicationIdOf = (named: string | undefined, call: CoachActionCall) => named ?? (call.inView?.kind === "application" ? call.inView.id : undefined);

export function applicationCoachActions(sources: ApplicationActionSources): CoachAction[] {
  const activeProfiles = async (candidateId: string) => (await sources.profiles.list(candidateId)).filter((profile) => !profile.archived);

  /** The Candidate's Application `applicationId`, unless it is an Archived Application (its Profile archived): out of reach. */
  async function reachable(candidateId: string, applicationId: string | undefined): Promise<Application | null> {
    if (!applicationId) return null;
    const [application, active] = await Promise.all([sources.applications.get(candidateId, applicationId), activeProfiles(candidateId)]);
    return application && active.some((profile) => profile.id === application.profile.id) ? application : null;
  }

  const profileField = async (candidateId: string, label: string) => ({
    name: "profileId",
    label,
    type: "select" as const,
    options: (await activeProfiles(candidateId)).map((profile) => ({ value: profile.id, label: profile.name })),
  });

  /** The Profile the Candidate left on the card: one of their active Profiles, or the field is invalid. */
  async function chosenProfile(candidateId: string, profileId: string | undefined) {
    const profile = (await activeProfiles(candidateId)).find((each) => each.id === profileId);
    return profile ?? null;
  }
  const invalidProfile: ApplyProposalResult = { ok: false, error: "invalid", errors: [{ field: "profileId", code: "invalid" }] };

  const application = defineCoachAction({
    name: PROPOSE_APPLICATION,
    description:
      "Propose d'enregistrer une offre d'emploi comme candidature du candidat (statut « À postuler »), avec un de ses profils actifs. jobOfferId : l'id de l'offre lue ; omis, l'offre que le candidat consulte. profileId : omis, son premier profil actif. Une seule candidature par offre : si elle existe déjà, rien n'est proposé, dis-le au candidat avec le lien.",
    schema: z.object({ jobOfferId: id.optional(), profileId: id.optional() }),
    group: "applications",
    kind: "propose",
    copiesText: false,
    async run({ jobOfferId, profileId }, call) {
      const { candidateId } = call;
      const inView = call.inView?.kind === "job_offer" ? call.inView.id : undefined;
      const offerId = jobOfferId ?? inView;
      if (!offerId) return NOT_FOUND;
      if (offerId !== inView && !(await sources.reachesJobOffer(candidateId, offerId))) return NOT_FOUND;
      const jobOffer = await sources.jobOffers.get(offerId, candidateId);
      if (!jobOffer) return NOT_FOUND;
      const saved = (await sources.applications.list(candidateId)).find((each) => each.jobOffer.id === jobOffer.id);
      if (saved) {
        if (saved.profile.archived) return told("Cette offre est déjà enregistrée comme candidature, avec un profil archivé : rien à proposer.");
        const href = routes.application(saved.id);
        return told(`Cette offre est déjà enregistrée comme candidature (id ${saved.id}) : rien à proposer. Dis-le au candidat et donne-lui le lien ${href}.`, { applicationId: saved.id, href });
      }
      const active = await activeProfiles(candidateId);
      const profile = profileId ? active.find((each) => each.id === profileId) : active[0];
      if (!profile) return profileId ? NOT_FOUND : told("Le candidat n'a aucun profil actif : rien à proposer. Dis-lui d'en créer un depuis Mon compte.");
      const { t } = createI18n(call.language);
      const href = routes.jobOffer(jobOffer.id);
      const change: ProposedChange = {
        target: { kind: "job_offer", id: jobOffer.id, name: offerName(jobOffer), href },
        what: t("coachProposals.fields.application"),
        before: t("coachProposals.values.notSaved"),
        after: t("coachProposals.values.saved", { status: t("applicationStatuses.to_apply"), profile: profile.name }),
        value: { profileId: profile.id },
        fields: [await profileField(candidateId, t("coachProposals.fields.applicationProfile"))],
        version: "",
      };
      return { ok: true, data: change, pages: [href], untrusted: true };
    },
    async apply(change, call) {
      const { candidateId } = call;
      const profile = await chosenProfile(candidateId, change.value.profileId);
      if (!profile) return invalidProfile;
      // Saved meanwhile (from its page, or another card): not what was proposed any more.
      if ((await sources.applications.list(candidateId)).some((each) => each.jobOffer.id === change.target.id)) return CONFLICT;
      const saved = await sources.applications.save(candidateId, { jobOfferId: change.target.id, profileId: profile.id }, { origin: origin(call) });
      if (!saved.ok) return "errors" in saved ? { ok: false, error: "invalid", errors: saved.errors } : NOT_FOUND;
      if (!saved.created) return CONFLICT;
      const status = await sources.applications.statusOf(candidateId, saved.application.id);
      return { ok: true, undo: { applicationId: saved.application.id, version: status?.version ?? "", profileId: profile.id } };
    },
    async undo(undo, { candidateId }) {
      const kept = z.object({ applicationId: z.string(), version: z.string(), profileId: z.string() }).safeParse(undo);
      if (!kept.success) return NOT_FOUND;
      const { applicationId, version, profileId } = kept.data;
      return sources.applications.removeIntact(candidateId, applicationId, { version, profileId });
    },
  });

  const status = defineCoachAction({
    name: PROPOSE_APPLICATION_STATUS,
    description:
      "Propose un nouveau statut pour une candidature du candidat : to_apply (À postuler), applied (Postulée), followed_up (Relancée), interview (Entretien), offer_received (Offre reçue), accepted (Acceptée), rejected (Refusée) ou abandoned (Abandonnée, qui l'archive). applicationId : omis, la candidature que le candidat consulte. Pour une relance envoyée, préfère propose_follow_up_sent.",
    schema: z.object({ applicationId: id.optional(), status: z.enum(APPLICATION_STATUSES) }),
    group: "applications",
    kind: "propose",
    copiesText: false,
    async run(args, call) {
      const { candidateId } = call;
      const found = await reachable(candidateId, applicationIdOf(args.applicationId, call));
      const state = found ? await sources.applications.statusOf(candidateId, found.id) : null;
      if (!found || !state) return NOT_FOUND;
      const href = routes.application(found.id);
      const { t } = createI18n(call.language);
      const label = (each: ApplicationStatus) => t(`applicationStatuses.${each}`);
      if (state.status === args.status) return told(`La candidature est déjà au statut « ${label(state.status)} » : rien à proposer.`, { applicationId: found.id, href });
      const what = t("coachProposals.fields.applicationStatus");
      const change: ProposedChange = {
        target: { kind: "application", id: found.id, name: offerName(found.jobOffer), href },
        what,
        before: label(state.status),
        after: label(args.status),
        value: { status: args.status },
        fields: [{ name: "status", label: what, type: "select", options: APPLICATION_STATUSES.map((each) => ({ value: each, label: label(each) })) }],
        version: state.version,
      };
      return { ok: true, data: change, pages: [href], untrusted: true };
    },
    async apply(change, call) {
      const { candidateId } = call;
      const id = change.target.id;
      const before = await sources.applications.statusOf(candidateId, id);
      if (!before || !(await reachable(candidateId, id))) return NOT_FOUND;
      if (before.version !== change.version) return CONFLICT;
      const changed = await sources.applications.change(candidateId, id, { status: change.value.status }, { version: change.version, origin: origin(call) });
      if (!changed.ok) return refused(changed);
      const after = await sources.applications.statusOf(candidateId, id);
      return { ok: true, undo: { applicationId: id, status: before.status, origin: before.origin, version: after?.version ?? "" } };
    },
    async undo(undo, { candidateId }) {
      const kept = z.object({ applicationId: z.string(), status: z.enum(APPLICATION_STATUSES), origin: z.unknown(), version: z.string() }).safeParse(undo);
      if (!kept.success) return NOT_FOUND;
      const { applicationId, status: before, origin: was, version } = kept.data;
      const changed = await sources.applications.change(candidateId, applicationId, { status: before }, { version, origin: readOrigin(was) });
      return changed.ok ? { ok: true } : refused(changed).error === "conflict" ? CONFLICT : NOT_FOUND;
    },
  });

  const profile = defineCoachAction({
    name: PROPOSE_APPLICATION_PROFILE,
    description:
      "Propose de changer le profil qu'utilise une candidature du candidat pour un autre de ses profils actifs (profileId, lu avec list_objects). applicationId : omis, la candidature que le candidat consulte.",
    schema: z.object({ applicationId: id.optional(), profileId: id }),
    group: "applications",
    kind: "propose",
    copiesText: false,
    async run(args, call) {
      const { candidateId } = call;
      const found = await reachable(candidateId, applicationIdOf(args.applicationId, call));
      const to = await chosenProfile(candidateId, args.profileId);
      if (!found || !to) return NOT_FOUND;
      const href = routes.application(found.id);
      if (found.profile.id === to.id) return told(`La candidature utilise déjà le profil « ${to.name} » : rien à proposer.`, { applicationId: found.id, href });
      const { t } = createI18n(call.language);
      const field = await profileField(candidateId, t("coachProposals.fields.applicationProfile"));
      const change: ProposedChange = {
        target: { kind: "application", id: found.id, name: offerName(found.jobOffer), href },
        what: field.label,
        before: found.profile.name,
        after: to.name,
        value: { profileId: to.id },
        fields: [field],
        version: found.profile.id,
      };
      return { ok: true, data: change, pages: [href], untrusted: true };
    },
    async apply(change, call) {
      const { candidateId } = call;
      const id = change.target.id;
      const before = await sources.applications.profileOf(candidateId, id);
      if (!before || !(await reachable(candidateId, id))) return NOT_FOUND;
      if (before.profileId !== change.version) return CONFLICT;
      const to = await chosenProfile(candidateId, change.value.profileId);
      if (!to) return invalidProfile;
      const changed = await sources.applications.change(candidateId, id, { profileId: to.id }, { version: change.version, origin: origin(call) });
      if (!changed.ok) return refused(changed);
      return { ok: true, undo: { applicationId: id, profileId: before.profileId, origin: before.origin, version: to.id } };
    },
    async undo(undo, { candidateId }) {
      const kept = z.object({ applicationId: z.string(), profileId: z.string(), origin: z.unknown(), version: z.string() }).safeParse(undo);
      if (!kept.success) return NOT_FOUND;
      const { applicationId, profileId, origin: was, version } = kept.data;
      const changed = await sources.applications.change(candidateId, applicationId, { profileId }, { version, origin: readOrigin(was) });
      return changed.ok ? { ok: true } : refused(changed).error === "conflict" ? CONFLICT : NOT_FOUND;
    },
  });

  const followUpSent = defineCoachAction({
    name: PROPOSE_FOLLOW_UP_SENT,
    description:
      `Propose de marquer une relance comme envoyée par le candidat sur une candidature « Postulée » ou « Relancée » : elle passe à « Relancée ». ${MAX_FOLLOW_UPS} relances au plus. Jobbbox n'envoie jamais rien à l'employeur : ne le propose que si le candidat dit l'avoir envoyée lui-même. applicationId : omis, la candidature que le candidat consulte.`,
    schema: z.object({ applicationId: id.optional() }),
    group: "applications",
    kind: "propose",
    copiesText: false,
    async run(args, call) {
      const { candidateId } = call;
      const found = await reachable(candidateId, applicationIdOf(args.applicationId, call));
      const sent = found ? await sources.followUps.sentOf(candidateId, found.id) : null;
      if (!found || !sent) return NOT_FOUND;
      const href = routes.application(found.id);
      if (sent.status !== "applied" && sent.status !== "followed_up") {
        return told("Une relance ne se marque que sur une candidature « Postulée » ou « Relancée » : rien à proposer.", { applicationId: found.id, href });
      }
      if (sent.count >= MAX_FOLLOW_UPS) return told("Deux relances sont déjà envoyées sur cette candidature, le maximum : rien à proposer.", { applicationId: found.id, href });
      const { t } = createI18n(call.language);
      const sentLabel = (count: number) => (count === 0 ? t("coachProposals.values.noFollowUp") : t("coachProposals.values.followUps", { count }));
      const change: ProposedChange = {
        target: { kind: "application", id: found.id, name: offerName(found.jobOffer), href },
        what: t("coachProposals.fields.followUpSent"),
        before: sentLabel(sent.count),
        after: t("coachProposals.values.followedUp", { sent: sentLabel(sent.count + 1), status: t("applicationStatuses.followed_up") }),
        value: {},
        fields: [],
        version: sent.version,
      };
      return { ok: true, data: change, pages: [href], untrusted: true };
    },
    async apply(change, call) {
      const { candidateId } = call;
      if (!(await reachable(candidateId, change.target.id))) return NOT_FOUND;
      const marked = await sources.followUps.markSent(candidateId, change.target.id, { version: change.version, origin: origin(call) });
      if (marked.ok) return { ok: true, undo: { applicationId: change.target.id, marked: marked.undo } };
      // No longer waiting for a Follow-up, or two sent since: not what was proposed any more.
      return marked.error === "not_found" ? NOT_FOUND : CONFLICT;
    },
    async undo(undo, { candidateId }) {
      const kept = z.object({ applicationId: z.string(), marked: z.unknown() }).safeParse(undo);
      if (!kept.success) return NOT_FOUND;
      return sources.followUps.unmarkSent(candidateId, kept.data.applicationId, kept.data.marked);
    },
  });

  return [application, status, profile, followUpSent];
}
