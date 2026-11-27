/**
 * Typed redirects (ADR-0114): where the AI Coach sends the Candidate when no Coach Action does what they ask. One row of
 * the redirect table per object with no Coach Action; the server builds each one (a page, a Section, the object, and its
 * link), the AI model only names the row: it never writes a link.
 *
 * One deep module. `createRedirects(sources).to(target, call)` gives the Typed redirect of one row, for the session's
 * Candidate: its page named after their object (« Profil Finance »), found from the arguments the model gave or from
 * what is In view (an Application's Profile for a Profile's row); the list of their Profiles when none can be told.
 *
 *   const redirect = await redirects.to("master_cv_section", { candidateId, language, inView, section: "languages" });
 *   // { page: "Profil Finance", section: "CV de référence", object: "Langues", href: "/profils/p1/cv" }
 *
 * `REDIRECT_TABLE` is kept in step with map #1084: a row leaves it once a Coach Action does what it stands for (#1094).
 * `REDIRECT_OF_ACTION` gives the row a refused Coach Action sends to (not offered, or narrowed by what was read).
 *
 * A row may be closed by a Platform Setting: `human_coach` (#1158) opens with « Espace coach v2 » (ADR-0107), read at each
 * call; closed, `to` gives null and `unavailable` what the AI Coach says instead, in one sentence (ADR-0119).
 */
import { createI18n } from "@jobhub/shared/i18n";
import type { Applications } from "../applications";
import type { CoachFocus } from "../coach/context";
import { MASTER_CV_EDIT_SECTIONS } from "../profiles/master-cv-proposal";
import type { Profiles } from "../profiles";
import { routes } from "../routes";
import type { TypedRedirect } from "./redirect-line";

export { readTypedRedirect, redirectLine, typedRedirectSchema, type TypedRedirect } from "./redirect-line";

/**
 * What a row's object is about: a Profile, an Application, the AI Coach's own (« Coach » in the menu), the Candidate's
 * account, their Plan (« Abonnement »), or their Human Coaches (« Mes coachs humains »).
 */
type RedirectScope = "profile" | "application" | "coach" | "account" | "plan" | "human_coach" | "none";

/**
 * The redirect table: one row per object the Candidate changes themselves, with no Coach Action (ADR-0114).
 * `searchCriteria`: a Search Criterion a card proposes but cannot edit before applying (« carte seule »: chosen on the page).
 */
export const REDIRECT_TABLE = {
  profile_rename: { scope: "profile", what: "renommer un profil" },
  profile_duplicate: { scope: "profile", what: "dupliquer un profil" },
  profile_create: { scope: "none", what: "créer un profil" },
  profile_delete: { scope: "profile", what: "supprimer un profil (il s'archive, il ne se supprime pas)" },
  master_cv_version_restore: { scope: "profile", what: "restaurer une version du CV de référence" },
  master_cv_section: { scope: "profile", what: "ajouter soi-même au CV de référence ce qu'il ne dit pas encore (une compétence, une langue…), dans sa rubrique (section)" },
  search_criteria: { scope: "profile", what: "choisir soi-même un critère de recherche que la carte ne modifie pas (secteur, type de contrat, télétravail…)" },
  job_offer_unpublished: { scope: "application", what: "signaler qu'une offre n'est plus publiée" },
  interview_delete: { scope: "application", what: "supprimer un entretien saisi par erreur" },
  company_dossier: {
    scope: "application",
    what: "lire soi-même le dossier entreprise d'une candidature ou d'une entreprise cible et ses fonctions à contacter, quand la recherche de contacts est indisponible sur Jobbbox",
  },
  coach_memory: { scope: "coach", what: "modifier ou supprimer un élément de la mémoire du coach, ou y retenir ce que tu ne peux pas proposer" },
  coach_conversation_delete: { scope: "coach", what: "supprimer une conversation (ses actions « … » à côté de son nom, sous « Coach » dans le menu) ou en effacer les messages (« Effacer la conversation »)" },
  account_delete: { scope: "account", what: "supprimer son compte ou ses données" },
  plan: { scope: "plan", what: "changer d'offre pour ce que la sienne n'inclut pas (les contacts enrichis de l'offre Premium) : tu ne changes jamais d'offre ni ne paies à sa place" },
  human_coach: { scope: "human_coach", what: "parler à un coach humain, choisir son coach et réserver une séance : tu ne réserves ni ne paies jamais à sa place" },
} as const satisfies Record<string, { scope: RedirectScope; what: string }>;

export type RedirectTarget = keyof typeof REDIRECT_TABLE;
export const REDIRECT_TARGETS = Object.keys(REDIRECT_TABLE) as RedirectTarget[];

/** The row a refused Coach Action sends the Candidate to: the page where they make that change themselves. */
export const REDIRECT_OF_ACTION: Readonly<Record<string, RedirectTarget>> = {
  propose_master_cv_changes: "master_cv_section",
  propose_search_criteria: "search_criteria",
  propose_coach_memory: "coach_memory",
  propose_profile_archive: "profile_delete",
  propose_profile_restore: "profile_delete",
};

/** The Candidate's objects a redirect is named after, each scoped to the Candidate. */
export interface RedirectSources {
  profiles: Pick<Profiles, "get" | "list">;
  applications: Pick<Applications, "get">;
}

/** Who a redirect is for, and what it is about: the ids the model gave, else what is In view. */
export interface RedirectCall {
  candidateId: string;
  language: "fr" | "en";
  inView?: CoachFocus;
  profileId?: string;
  applicationId?: string;
  /** For `master_cv_section`: the Master CV's section; for `search_criteria`: never needed. */
  section?: (typeof MASTER_CV_EDIT_SECTIONS)[number];
}

/** The Platform Settings a row opens with, read at each call. */
export interface RedirectSettings {
  /** « Espace coach v2 » (ADR-0107): the `human_coach` row. Default: off, as the setting is. */
  coachSpaceV2?: () => boolean;
}

export interface Redirects {
  /** The Typed redirect of `target`, for `call.candidateId`; null for a row no one has (an unknown target) or closed now. */
  to(target: string, call: RedirectCall): Promise<TypedRedirect | null>;
  /** What the AI Coach is told of a row closed now by its Platform Setting, in French; null for an open row or an unknown one. */
  unavailable(target: string): string | null;
}

/**
 * Why a row is closed, as the AI Coach is told it: one sentence to the Candidate, with no redirect. Closed is never « it does
 * not exist »: with « Espace coach v2 » off, « Mes coachs humains » is the former page (ADR-0107), still in the menu
 * (`sidebar-nav.ts`), where the Candidate books and pays for a session with a Human Coach as before the epic.
 */
const CLOSED_HUMAN_COACH_MENU = createI18n("fr").t("account.humanCoaches");
const CLOSED: Partial<Record<RedirectTarget, string>> = {
  human_coach: `Le renvoi human_coach n'est pas disponible, mais Jobbbox propose bien des séances avec un coach humain : le candidat choisit son coach et réserve lui-même une séance depuis « ${CLOSED_HUMAN_COACH_MENU} », dans le menu. Dis-le au candidat en une phrase, sans renvoi ni lien, sans inventer de nom de coach ni de prix ; tu ne réserves ni ne paies jamais à sa place. Puis propose ce que tu peux faire toi-même pour l'aider.`,
};

const CV_SECTION_KEY = {
  headline: "cvReview.headline",
  summary: "cvReview.summary",
  experience: "cvReview.experience",
  education: "cvReview.education",
  skills: "cvReview.skills",
  languages: "cvReview.languages",
} as const satisfies Record<(typeof MASTER_CV_EDIT_SECTIONS)[number], string>;

export const isRedirectTarget = (value: unknown): value is RedirectTarget => typeof value === "string" && Object.hasOwn(REDIRECT_TABLE, value);

export function createRedirects(sources: RedirectSources | null, settings: RedirectSettings = {}): Redirects {
  /** Whether `target` is closed now by its Platform Setting. */
  const closed = (target: RedirectTarget) => target === "human_coach" && !(settings.coachSpaceV2?.() ?? false);

  /** The Candidate's active Profile `id`; null for an Archived Profile, another's or an unknown id. */
  const activeProfile = async (candidateId: string, id: string | undefined) => {
    if (!id || !sources) return null;
    const profile = await sources.profiles.get(candidateId, id);
    return profile && !profile.archived ? profile : null;
  };
  const application = async (candidateId: string, id: string | undefined) => (id && sources ? sources.applications.get(candidateId, id) : null);

  /** The Profile a row is about: the one named, else the one In view, else the In view Application's, else their only one. */
  async function profileOf(call: RedirectCall) {
    const { candidateId, inView } = call;
    const named = await activeProfile(candidateId, call.profileId);
    if (named) return named;
    if (inView?.kind === "profile") return activeProfile(candidateId, inView.id);
    const shown = await application(candidateId, call.applicationId ?? (inView?.kind === "application" ? inView.id : undefined));
    if (shown) return activeProfile(candidateId, shown.profile.id);
    const active = sources ? (await sources.profiles.list(candidateId)).filter((profile) => !profile.archived) : [];
    return active.length === 1 ? active[0]! : null;
  }

  return {
    unavailable: (target) => (isRedirectTarget(target) && closed(target) ? (CLOSED[target] ?? null) : null),
    async to(target, call) {
      if (!isRedirectTarget(target) || closed(target)) return null;
      const { t } = createI18n(call.language);
      const object = t(`coachRedirects.objects.${target}`);
      const { scope } = REDIRECT_TABLE[target];
      if (scope === "none") return { page: t("coachRedirects.pages.newProfile"), section: null, object, href: routes.newProfile };
      // The AI Coach's own, under « Coach » in the menu: the Coach Memory opens beside the conversation.
      if (scope === "coach") return { page: t("coachRedirects.pages.coach"), section: null, object, href: target === "coach_memory" ? routes.coachMemory : routes.home };
      if (scope === "account") return { page: t("coachRedirects.pages.account"), section: t("coachRedirects.sections.data"), object, href: routes.accountData };
      if (scope === "plan") return { page: t("coachRedirects.pages.subscription"), section: null, object, href: routes.subscription };
      // Their Human Coaches' page, where they choose one and book (ADR-0107 on): the AI Coach never books nor pays.
      if (scope === "human_coach") return { page: t("coachRedirects.pages.humanCoaches"), section: null, object, href: routes.coaching };
      if (scope === "application") {
        const found = await application(call.candidateId, call.applicationId ?? (call.inView?.kind === "application" ? call.inView.id : undefined));
        // A Target Company's dossier with no Spontaneous Application yet (#1157): its Profile's Entreprises cibles.
        if (!found && target === "company_dossier" && call.profileId) {
          const profile = await activeProfile(call.candidateId, call.profileId);
          if (profile)
            return {
              page: t("coachRedirects.pages.profile", { name: profile.name }),
              section: t("profilePage.sections.entreprises-cibles"),
              object,
              href: routes.profileSection(profile.id, "entreprises-cibles"),
            };
        }
        // No Application told: the list of them, where the Candidate opens the one they mean.
        if (!found) return { page: t("coachRedirects.pages.applications"), section: null, object, href: routes.applications };
        const page = t("coachRedirects.pages.application", { name: [found.jobOffer.title, found.jobOffer.employer].filter(Boolean).join(" · ") });
        const section = target === "interview_delete" ? "entretiens" : target === "company_dossier" ? "dossier" : "offre";
        return { page, section: t(`application.sections.${section}`), object, href: routes.applicationSection(found.id, section) };
      }
      const profile = await profileOf(call);
      // No Profile told: the list of the Candidate's Profiles, where they open the one they mean.
      if (!profile) return { page: t("coachRedirects.pages.profiles"), section: null, object, href: routes.accountProfiles };
      const page = t("coachRedirects.pages.profile", { name: profile.name });
      switch (target) {
        case "profile_rename":
          return { page, section: null, object, href: routes.profile(profile.id) };
        case "profile_duplicate":
        case "profile_delete":
          return { page, section: t("profilePage.sections.gerer"), object, href: routes.profileSection(profile.id, "gerer") };
        case "master_cv_version_restore":
          return { page, section: t("profilePage.sections.cv-de-reference"), object, href: routes.masterCvVersions(profile.id) };
        case "master_cv_section":
          return { page, section: t("profilePage.sections.cv-de-reference"), object: call.section ? t(CV_SECTION_KEY[call.section]) : object, href: routes.editMasterCv(profile.id) };
        case "search_criteria":
          return { page, section: t("coachRedirects.sections.searchCriteria"), object, href: routes.profile(profile.id) };
        default:
          return null;
      }
    },
  };
}

/** The redirect table as the AI Coach is told it: one line per row, the name to give `redirect`. */
export const redirectTableText = () => REDIRECT_TARGETS.map((target) => `- ${target} : ${REDIRECT_TABLE[target].what}`).join("\n");
