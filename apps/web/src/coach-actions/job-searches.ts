/**
 * The « Recherches d'offres » and « Job Digests » Coach Actions (#720, ADR-0077): what the AI Coach proposes on the
 * Candidate's Job Searches and Job Digests, each an Action Card under its reply, applied through the Job Searches and
 * Job Digests modules the pages' routes call (the same validation, the same Plan Quota):
 *  - `propose_job_search`: launch a Job Search of an active Profile on its Search Criteria (the Profile named, In view,
 *    or the one of the Job Search or Job Digest In view). Its card says the Plan Quota it uses (« 1 recherche sur 5 cette
 *    semaine ») and, without room, is the Upgrade prompt in place of « Lancer »: the worker is never asked. « Lancer »
 *    starts it (`JobSearches.start`, which uses the Plan Quota and queues Job discovery); it is followed in AI Activity
 *    and ends with Stop: no « Annuler ». Other Search Criteria are proposed first (`propose_search_criteria`, #719).
 *  - `propose_job_search_stop`: stop a Job Search still searching (a Stop request), its Job Offers found kept. No « Annuler ».
 *  - `propose_job_digest_frequency`: opt in to a Profile's Job Digest, change its frequency within the Plan, or opt out.
 *    Above the Plan, the Upgrade prompt. « Annuler » puts the frequency before back.
 * None copies text (`copiesText: false`): they stay offered while a Job Offer is In view. Each is scoped to the session's
 * Candidate: another's id, an Archived Profile or an unknown id is `not_found`.
 *
 *   searchCoachActions({ profiles, jobSearches, jobDigests, jobSearchQuota })
 */
import { JOB_DIGEST_FREQUENCIES, type JobDigestFrequency } from "@jobhub/shared";
import { createI18n } from "@jobhub/shared/i18n";
import * as z from "zod";
import type { Billing } from "../billing";
import { upgradePrompt, type QuotaRefusal, type UpgradePrompt } from "../billing/upgrade-prompt";
import { searchCriteriaInWords } from "../components/job-search-words";
import type { JobDigests, SubscribeResult } from "../job-digests";
import type { JobSearches } from "../job-searches";
import type { Profile, Profiles } from "../profiles";
import { routes } from "../routes";
import { defineCoachAction, type ApplyProposalResult, type CoachAction, type CoachActionCall, type CoachActionResult, type ProposedChange, type UndoProposalResult } from "./index";

type Translate = ReturnType<typeof createI18n>["t"];

/** The Candidate's weekly Plan Quota of Job Searches now: what is used, the limit (null: unlimited), and the refusal once used up. */
export interface JobSearchQuota {
  used: number;
  limit: number | null;
  refusal: QuotaRefusal | null;
}

/** The domain modules these Coach Actions go through, each scoped to the Candidate. */
export interface SearchActionSources {
  profiles: Pick<Profiles, "list" | "get">;
  jobSearches: Pick<JobSearches, "start" | "stop" | "get" | "latest" | "searching">;
  jobDigests: Pick<JobDigests, "settings" | "allows" | "subscribe" | "unsubscribe" | "get">;
  jobSearchQuota(candidateId: string): Promise<JobSearchQuota>;
}

export const SEARCH_ACTIONS = { start: "propose_job_search", stop: "propose_job_search_stop", digestFrequency: "propose_job_digest_frequency" } as const;

/** The Job Search Plan Quota as the billing module keeps it: this week's uses, the Plan's limit, its refusal once used up. */
export function jobSearchQuotaOf(billing: Pick<Billing, "entitlements" | "allows">): SearchActionSources["jobSearchQuota"] {
  return async (candidateId) => {
    const { quotas, usedThisWeek } = await billing.entitlements(candidateId);
    const limit = quotas.jobSearches;
    const used = usedThisWeek.jobSearches;
    if (limit === null || used < limit) return { used, limit, refusal: null };
    const decision = await billing.allows(candidateId, "jobSearches");
    return { used, limit, refusal: decision.allowed ? null : decision };
  };
}

const id = z.string().min(1).max(200);
const NOT_FOUND = { ok: false, error: "not_found" } as const;
const CONFLICT = { ok: false, error: "conflict" } as const;

/** A proposing Coach Action's answer when there is nothing to propose: the model is told why, no card is made. */
const told = (message: string, href?: string): CoachActionResult => ({ ok: true, proposes: false, data: { message, ...(href ? { href } : {}) }, ...(href ? { pages: [href] } : {}) });

/** A Job Digest's frequency as a proposal sets it: "none" is opted out. */
const DIGEST_CHOICES = ["weekly", "daily", "none"] as const;
type DigestChoice = (typeof DIGEST_CHOICES)[number];
const isDigestChoice = (value: unknown): value is DigestChoice => (DIGEST_CHOICES as readonly unknown[]).includes(value);

const rank = (frequency: JobDigestFrequency) => JOB_DIGEST_FREQUENCIES.indexOf(frequency);

/** What « Annuler » needs: the Profile, the frequency before, and the one applying left. */
const digestUndo = z.object({ profileId: z.string(), before: z.enum(DIGEST_CHOICES), after: z.enum(DIGEST_CHOICES) });

export function searchCoachActions(sources: SearchActionSources): CoachAction[] {
  /** The Candidate's active Profile `profileId`; null for an Archived Profile, another's or an unknown id. */
  async function activeProfile(candidateId: string, profileId: string): Promise<Profile | null> {
    const profile = await sources.profiles.get(candidateId, profileId);
    return profile && !profile.archived ? profile : null;
  }

  /**
   * The Profile the call is about: the one named, else the one In view (a Profile, or the Profile of the Job Search or
   * Job Digest In view), else the Candidate's only active Profile. `undefined`: several, none named.
   */
  async function profileIdOf(named: string | undefined, call: CoachActionCall): Promise<string | null | undefined> {
    if (named) return named;
    const inView = call.inView;
    if (inView?.kind === "profile") return inView.id;
    if (inView?.kind === "job_search") return (await sources.jobSearches.get(call.candidateId, inView.id))?.profile.id ?? null;
    if (inView?.kind === "job_digest") return (await sources.jobDigests.get(call.candidateId, inView.id))?.profile.id ?? null;
    const active = (await sources.profiles.list(call.candidateId)).filter((profile) => !profile.archived);
    return active.length === 1 ? active[0]!.id : active.length === 0 ? null : undefined;
  }
  const severalProfiles = (what: string) =>
    told(`Le candidat a plusieurs profils actifs : précise lequel (profileId, lu dans l'index de ses objets) avant de proposer ${what}, ou demande-lui.`);

  /** Day and time in French time, in the Candidate's language. */
  const format = (language: "fr" | "en", options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(language === "en" ? "en-GB" : "fr-FR", { timeZone: "Europe/Paris", ...options });

  const searchCriteriaText = (t: Translate, language: "fr" | "en", profile: Profile) =>
    [profile.searchCriteria.targetRole, searchCriteriaInWords(profile.searchCriteria, t, language === "en" ? "en-GB" : "fr-FR")].filter(Boolean).join(" · ");

  /** What the Job Search will use of the Plan Quota, or the Upgrade prompt without room. */
  async function jobSearchQuota(t: Translate, call: CoachActionCall): Promise<{ label: string; prompt?: UpgradePrompt }> {
    const { used, limit, refusal } = await sources.jobSearchQuota(call.candidateId);
    if (limit === null) return { label: t("coachProposals.quota.jobSearchUnlimited") };
    if (refusal) return { label: t("coachProposals.quota.jobSearchNone", { limit }), prompt: upgradePrompt(refusal, call.language) };
    return { label: t("coachProposals.quota.jobSearch", { limit, left: Math.max(0, limit - used - 1) }) };
  }

  const start = defineCoachAction({
    name: SEARCH_ACTIONS.start,
    description:
      "Propose de lancer une recherche d'offres (Job Search) pour un profil actif du candidat, sur les critères de recherche de ce profil, quand il le demande (« relance une recherche », « cherche-moi des offres »). profileId : omis, le profil consulté (ou celui de la recherche ou du Job Digest consulté). Elle consomme une recherche du quota hebdomadaire de son offre : la carte le dit, ou propose de changer d'offre s'il n'en reste plus. Le candidat la lance lui-même sous ta réponse et la suit dans Activité IA. Si le candidat veut d'autres critères de recherche, propose d'abord de les modifier (propose_search_criteria si elle t'est offerte, sinon depuis son profil), jamais de les contourner.",
    schema: z.object({ profileId: id.optional() }),
    group: "job_searches",
    kind: "propose",
    copiesText: false,
    async run({ profileId }, call) {
      const { candidateId, language } = call;
      const wanted = await profileIdOf(profileId, call);
      if (wanted === undefined) return severalProfiles("une recherche");
      const profile = wanted ? await activeProfile(candidateId, wanted) : null;
      if (!profile) return NOT_FOUND;
      const searching = await sources.jobSearches.searching(candidateId, profile.id);
      if (searching) {
        const href = routes.jobSearch(searching.id);
        return told(`Une recherche est déjà en cours pour ce profil (id ${searching.id}) : rien à proposer. Le candidat la suit dans Activité IA, où il peut l'arrêter ; donne-lui le lien ${href}.`, href);
      }
      const { t } = createI18n(language);
      const latest = await sources.jobSearches.latest(candidateId, profile.id);
      const change: ProposedChange = {
        target: { kind: "profile", id: profile.id, name: profile.name, href: routes.jobSearches(profile.id) },
        what: t("coachProposals.fields.jobSearch"),
        before: latest ? t("coachProposals.values.lastSearch", { date: format(language, { dateStyle: "long" }).format(latest.startedAt) }) : t("coachProposals.values.noSearch"),
        after: t("coachProposals.values.searchOn", { criteria: searchCriteriaText(t, language, profile) }),
        value: { profileId: profile.id },
        fields: [],
        version: "idle",
        quota: await jobSearchQuota(t, call),
        launches: true,
      };
      return { ok: true, data: change, pages: [routes.jobSearches(profile.id)] };
    },
    async apply(change, { candidateId }) {
      const profileId = change.target.id;
      if (!(await activeProfile(candidateId, profileId))) return NOT_FOUND;
      // One started since (here or on its page): not launched twice.
      if (await sources.jobSearches.searching(candidateId, profileId)) return CONFLICT;
      const started = await sources.jobSearches.start(candidateId, { profileId });
      if (started.ok) return { ok: true };
      if ("errors" in started) return { ok: false, error: "invalid", errors: started.errors };
      // The room used since the proposal: no longer what was proposed.
      return started.error === "quota_exceeded" ? CONFLICT : NOT_FOUND;
    },
  });

  const stop = defineCoachAction({
    name: SEARCH_ACTIONS.stop,
    description:
      "Propose d'arrêter une recherche d'offres encore en cours, quand le candidat le demande ; les offres déjà trouvées sont gardées. jobSearchId : omis, la recherche consultée, ou celle en cours du profil profileId (omis, le profil consulté). Le candidat l'arrête lui-même sous ta réponse.",
    schema: z.object({ jobSearchId: id.optional(), profileId: id.optional() }),
    group: "job_searches",
    kind: "propose",
    copiesText: false,
    async run({ jobSearchId, profileId }, call) {
      const { candidateId, language } = call;
      let searchId = jobSearchId ?? (call.inView?.kind === "job_search" ? call.inView.id : undefined);
      if (!searchId) {
        const wanted = await profileIdOf(profileId, call);
        if (wanted === undefined) return severalProfiles("d'arrêter une recherche");
        const profile = wanted ? await activeProfile(candidateId, wanted) : null;
        if (!profile) return NOT_FOUND;
        const searching = await sources.jobSearches.searching(candidateId, profile.id);
        if (!searching) return told("Aucune recherche en cours pour ce profil : rien à arrêter.");
        searchId = searching.id;
      }
      const jobSearch = await sources.jobSearches.get(candidateId, searchId);
      if (!jobSearch || !(await activeProfile(candidateId, jobSearch.profile.id))) return NOT_FOUND;
      const href = routes.jobSearch(jobSearch.id);
      if (jobSearch.status !== "searching") return told("Aucune recherche en cours : celle-ci est déjà terminée, rien à arrêter.", href);
      const { t } = createI18n(language);
      const change: ProposedChange = {
        target: { kind: "job_search", id: jobSearch.id, name: jobSearch.profile.name, href },
        what: t("coachProposals.fields.jobSearchStop"),
        before: t("coachProposals.values.searching", { time: format(language, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(jobSearch.startedAt) }),
        after: t("coachProposals.values.stopped"),
        value: {},
        fields: [],
        version: "searching",
      };
      return { ok: true, data: change, pages: [href] };
    },
    async apply(change, { candidateId }) {
      const stopped = await sources.jobSearches.stop(candidateId, change.target.id);
      if (stopped.ok) return { ok: true };
      return stopped.error === "over" ? CONFLICT : NOT_FOUND;
    },
  });

  /** A Profile's Job Digest as the card tells it: "none" while it is not sent. */
  const digestNow = async (candidateId: string, profileId: string) => {
    const settings = await sources.jobDigests.settings(candidateId, profileId);
    return settings ? { settings, current: (settings.subscribed ? settings.frequency : "none") as DigestChoice } : null;
  };
  const digestLabel = (t: Translate, choice: DigestChoice) => (choice === "none" ? t("coachProposals.values.noDigest") : t(`jobDigest.frequencyOptions.${choice}`));

  /** The Upgrade prompt of a frequency the Plan does not send. */
  const digestPrompt = (refused: Exclude<SubscribeResult, { ok: true }>, frequency: DigestChoice, language: "fr" | "en"): UpgradePrompt | null => {
    if (refused.error !== "not_included" && refused.error !== "above_plan") return null;
    const { plan, planName, upgradeTo, upgradeToName } = refused;
    return upgradePrompt({ quota: "jobDigest", plan, planName, limit: 0, upgradeTo, upgradeToName, ...(refused.error === "above_plan" && frequency === "daily" ? { frequency: "daily" as const } : {}) }, language);
  };

  /** Sets the Profile's Job Digest at `choice`, as the page's form does; the refusal of a frequency the Plan does not send. */
  async function setDigest(candidateId: string, profileId: string, choice: DigestChoice): Promise<SubscribeResult | { ok: true }> {
    if (choice === "none") {
      await sources.jobDigests.unsubscribe(candidateId, profileId);
      return { ok: true };
    }
    return sources.jobDigests.subscribe(candidateId, profileId, choice);
  }

  const digestFrequency = defineCoachAction({
    name: SEARCH_ACTIONS.digestFrequency,
    description:
      "Propose d'abonner un profil actif du candidat à son Job Digest (e-mail des nouvelles offres), d'en changer la fréquence ou de l'en désabonner, quand il le demande. frequency : weekly (chaque semaine), daily (chaque jour) ou none (désabonnement). profileId : omis, le profil consulté (ou celui du Job Digest consulté). Une fréquence que son offre ne comprend pas : la carte propose de changer d'offre. Le candidat l'applique lui-même sous ta réponse.",
    schema: z.object({ profileId: id.optional(), frequency: z.enum(DIGEST_CHOICES) }),
    group: "job_digests",
    kind: "propose",
    copiesText: false,
    async run({ profileId, frequency }, call) {
      const { candidateId, language } = call;
      const wanted = await profileIdOf(profileId, call);
      if (wanted === undefined) return severalProfiles("un Job Digest");
      const profile = wanted ? await activeProfile(candidateId, wanted) : null;
      const now = profile ? await digestNow(candidateId, profile.id) : null;
      if (!profile || !now) return NOT_FOUND;
      const href = routes.jobDigests;
      if (now.current === frequency) return told("Le Job Digest de ce profil est déjà à cette fréquence : rien à proposer.", href);
      const { t } = createI18n(language);
      const allowed = frequency === "none" ? { ok: true as const } : await sources.jobDigests.allows(candidateId, profile.id, frequency);
      const prompt = allowed.ok ? null : digestPrompt(allowed, frequency, language);
      if (!allowed.ok && !prompt) return NOT_FOUND;
      const planFrequency = now.settings.planFrequency;
      const choices = DIGEST_CHOICES.filter((choice) => choice === "none" || (planFrequency !== "none" && rank(choice) <= rank(planFrequency)));
      const what = t("coachProposals.fields.jobDigest");
      const change: ProposedChange = {
        target: { kind: "profile", id: profile.id, name: profile.name, href },
        what,
        before: digestLabel(t, now.current),
        after: digestLabel(t, frequency),
        value: { frequency },
        fields: [{ name: "frequency", label: t("jobDigest.frequencyLegend"), type: "select", options: choices.map((choice) => ({ value: choice, label: digestLabel(t, choice) })) }],
        version: now.current,
        ...(frequency === "none" ? {} : { quota: { label: planFrequency === "none" ? t("billing.jobDigest.none") : t(`jobDigest.frequency.${planFrequency}`), ...(prompt ? { prompt } : {}) } }),
      };
      return { ok: true, data: change, pages: [href] };
    },
    async apply(change, { candidateId }): Promise<ApplyProposalResult> {
      const profileId = change.target.id;
      const choice = change.value.frequency;
      if (!isDigestChoice(choice)) return { ok: false, error: "invalid", errors: [{ field: "frequency", code: "invalid" }] };
      const now = (await activeProfile(candidateId, profileId)) ? await digestNow(candidateId, profileId) : null;
      if (!now) return NOT_FOUND;
      if (now.current !== change.version) return CONFLICT;
      const set = await setDigest(candidateId, profileId, choice);
      if (!set.ok) return set.error === "not_found" || set.error === "archived" ? NOT_FOUND : { ok: false, error: "invalid", errors: [{ field: "frequency", code: "invalid" }] };
      const after = (await digestNow(candidateId, profileId))?.current ?? choice;
      return { ok: true, undo: { profileId, before: now.current, after } satisfies z.infer<typeof digestUndo> };
    },
    async undo(undo, { candidateId }): Promise<UndoProposalResult> {
      const kept = digestUndo.safeParse(undo);
      if (!kept.success) return NOT_FOUND;
      const { profileId, before, after } = kept.data;
      const now = (await activeProfile(candidateId, profileId)) ? await digestNow(candidateId, profileId) : null;
      if (!now) return NOT_FOUND;
      if (now.current !== after) return CONFLICT;
      const set = await setDigest(candidateId, profileId, before);
      // The Plan no longer sends it as often as before: not what « Annuler » would put back.
      return set.ok ? { ok: true } : CONFLICT;
    },
  });

  return [start, stop, digestFrequency];
}
