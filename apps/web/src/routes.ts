import type { LegalTextId } from "@jobhub/help";
import type { CalendarView } from "./agenda/calendar";

/** The Sections of a Profile's page, in order (ADR-0024). */
export const PROFILE_SECTIONS = ["propositions", "cv-de-reference", "ats-score", "entreprises-cibles", "telecharger", "gerer"] as const;
export type ProfileSection = (typeof PROFILE_SECTIONS)[number];

/** The Sections of an Application's page, in order (ADR-0024). */
export const APPLICATION_SECTIONS = ["propositions", "documents", "correspondance", "entretiens", "avis", "dossier", "contacts", "offre"] as const;
export type ApplicationSection = (typeof APPLICATION_SECTIONS)[number];

/** The Order pages (#512), and what their address carries: the Plan or the Human Coach, a shared link's code, an error. */
export const PLAN_ORDER = "/abonnement/commande";
export const COACHING_ORDER = "/coachs/commande";
export const ORDER_PARAMS = { plan: "offre", coach: "coach", code: "code", error: "erreur" } as const;
/** Where each Order page's « Passer au paiement » posts. */
export const ORDER_ACTIONS = { plan: "/api/billing/checkout", coachingSession: "/api/coaching/checkout" } as const;
/** The error an Order page is sent back with when the CGV box was not ticked. */
export const ORDER_CGV_ERROR = "cgv";

/** Paths of the web app's pages. French, like the interface default. */
export const routes = {
  home: "/",
  /** A Free conversation (ADR-0070), under « Conversation au centre » (#601): the page is the conversation. */
  conversation: (id: string) => `/conversations/${encodeURIComponent(id)}`,
  signIn: "/connexion",
  /** The Back Office sign-in: the providers allowed for Administrators; where Require SSO sends an Administrator. */
  backOfficeSignIn: "/connexion/back-office",
  account: "/compte",
  /** Mon compte's Sections (ADR-0024); `account` itself shows the first, the Profiles. */
  accountProfiles: "/compte/profils",
  accountFollowUps: "/compte/relances",
  accountReminders: "/compte/rappels",
  accountEuAi: "/compte/ia-europeenne",
  /** « Réception par email » (#441): Email intake and the Candidate's Forwarding address. */
  accountEmailIntake: "/compte/reception-email",
  accountEmailIntakeWizard: "/compte/reception-email/assistant",
  accountSignIn: "/compte/connexion",
  accountPreferences: "/compte/preferences",
  accountTools: "/compte/outils",
  /** « Mes signalements » (#377): the Candidate's Signalements and the team's replies; where the Signalement notification leads. */
  accountSignalements: "/compte/signalements",
  accountData: "/compte/donnees",
  newProfile: "/profils/nouveau",
  profile: (id: string) => `/profils/${id}`,
  /** The Recherches d'offres page (ADR-0024); with `profileId`, for that Profile. */
  jobSearches: (profileId?: string) => (profileId ? `/recherches?profil=${encodeURIComponent(profileId)}` : "/recherches"),
  /** The Recherches d'offres page for all active Profiles at once, their results in tabs or, with `lanes`, in swimlanes. */
  allJobSearches: (lanes = false) => `/recherches?profil=tous${lanes ? "&vue=couloirs" : ""}`,
  /** The Job Digests page (ADR-0024). */
  jobDigests: "/job-digests",
  /** A Section of a Profile's page (ADR-0024); `profile` itself shows the first one there is. */
  profileSection: (id: string, section: ProfileSection) => `/profils/${id}/${section}`,
  editMasterCv: (id: string) => `/profils/${id}/cv`,
  masterCvVersions: (id: string) => `/profils/${id}/versions`,
  applications: "/candidatures",
  /**
   * The Agenda (« Entretiens et rendez-vous »): in the view last picked in this browser (the list by default),
   * or, with `past`, the past Agenda Items as a list.
   */
  agenda: (past = false) => (past ? "/agenda?periode=passes" : "/agenda"),
  /** The Agenda as a list, whatever view was last picked: upcoming Agenda Items, with `past` the past ones. */
  agendaList: (past = false) => `/agenda?vue=liste${past ? "&periode=passes" : ""}`,
  /** The Agenda's week or month around `date` (a day in French time, "2026-10-20"), today's when left out (ADR-0028). */
  agendaCalendar: (view: CalendarView, date?: string) => `/agenda?vue=${view}${date ? `&date=${date}` : ""}`,
  applicationsBoard: "/candidatures?vue=tableau",
  application: (id: string) => `/candidatures/${id}`,
  /** A Section of an Application's page (ADR-0024); `application` itself shows the first one there is. */
  applicationSection: (id: string, section: ApplicationSection) => `/candidatures/${id}/${section}`,
  /** A Job Offer's page; with `profileId`, its Match Score preselects that Profile (the one a Job Search or Job Digest is for). */
  jobOffer: (id: string, profileId?: string) => (profileId ? `/offres/${id}?profil=${encodeURIComponent(profileId)}` : `/offres/${id}`),
  jobSearch: (id: string) => `/recherches/${id}`,
  /** One Job Digest: its Job Offers ranked by Match Score. */
  jobDigest: (id: string) => `/job-digests/${id}`,
  masterCvVersion: (id: string, version: number) => `/profils/${id}/versions/${version}`,
  subscription: "/abonnement",
  /**
   * « Renoncer au contrat ici » (#511): the Withdrawal form for one contract (`contract`: "plan", or
   * "coaching-session:<id>"), or, with `done`, the Withdrawal just recorded.
   */
  withdrawal: (contract: string) => `/abonnement/retractation?contrat=${encodeURIComponent(contract)}`,
  withdrawalDone: (id: string) => `/abonnement/retractation?faite=${encodeURIComponent(id)}`,
  /**
   * The Order page before Stripe Checkout for a paid Plan (#512): its summary, the CGV box and the Immediate Performance
   * Request. `code`: a shared link's, carried to Checkout; `error`: sent back over the CGV box.
   */
  planOrder: (plan: string, options: { code?: string | null | undefined; error?: typeof ORDER_CGV_ERROR } = {}) =>
    `${PLAN_ORDER}?${new URLSearchParams({ [ORDER_PARAMS.plan]: plan, ...(options.code ? { [ORDER_PARAMS.code]: options.code } : {}), ...(options.error ? { [ORDER_PARAMS.error]: options.error } : {}) })}`,
  /** The Order page before Stripe Checkout for a Coaching Session with a Human Coach (#512). */
  coachingOrder: (coachId: string, options: { error?: typeof ORDER_CGV_ERROR } = {}) =>
    `${COACHING_ORDER}?${new URLSearchParams({ [ORDER_PARAMS.coach]: coachId, ...(options.error ? { [ORDER_PARAMS.error]: options.error } : {}) })}`,
  /** « Résilier votre contrat » (#513): what cancelling the paid Plan does, and « Confirmer la résiliation ». */
  subscriptionCancellation: "/abonnement/resiliation",
  /** Cancelling a subscription, refunded prorata, over a Quota Reduction the Candidate was told of (#514). */
  subscriptionQuotaReduction: "/abonnement/baisse",
  /** The Candidate's Human Coaches: Coaching Sessions and Coach Access. */
  coaching: "/coachs",
  /** One of the Candidate's Coaching Sessions, on the Human Coaches page: where an Agenda Item for it leads. */
  coachingSession: (id: string) => `/coachs#seance-${id}`,
  /** A Human Coach's own pages: the Candidates who granted them Coach Access. */
  coachSpace: "/espace-coach",
  coachSpaceCandidate: (candidateId: string) => `/espace-coach/${encodeURIComponent(candidateId)}`,
  coachSpaceApplication: (candidateId: string, applicationId: string) => `/espace-coach/${encodeURIComponent(candidateId)}/candidatures/${applicationId}`,
  accountDeleted: "/compte/supprime",
  /** The Acceptance screen (ADR-0062, #510): the CGU version to accept after sign-in, before anything else. */
  acceptance: "/acceptation",
  /** Where a Job Digest email's unsubscribe link leads (no sign-in needed). */
  jobDigestUnsubscribe: "/desabonnement",
  /** Nouveautés (#470, ADR-0063): the Release Notes, newest first; public. */
  nouveautes: "/nouveautes",
  /**
   * Légal (ADR-0062): a Legal Text (the CGU by default), the version in effect; or `version`, its permanent dated
   * address. Public.
   */
  legal: (text: LegalTextId = "cgu", version?: string) => `/legal/${text}${version ? `/${version}` : ""}`,
  /** A Legal Text's version history: each version with its effective date, change and line. */
  legalVersions: (text: LegalTextId) => `/legal/${text}/versions`,
  /** A Legal Text Version as a PDF to download (« Télécharger en PDF »), in the page's language. */
  legalPdf: (text: LegalTextId, version: string, lang: string) =>
    `/api/legal/${text}/pdf?version=${encodeURIComponent(version)}&lang=${encodeURIComponent(lang)}`,
  admin: "/admin",
  /** The Plans (Offres): names, rank, offered or hidden, Stripe product, Plan Features. */
  adminPlans: "/admin/offres",
  adminPlanQuotas: "/admin/quotas",
  /** Coupons (Codes promo): Stripe promotion codes, Plans managers. */
  adminCoupons: "/admin/codes-promo",
  /** The Withdrawals (Rétractations, #511): every one and its refunds, a failed refund tried again; super-admins and Support. */
  adminWithdrawals: "/admin/retractations",
  adminHumanCoaches: "/admin/coachs",
  /** The AI Coach's cost per reply, per day: median and p90 against the target. */
  adminCoachCost: "/admin/cout-coach",
  /** The Coaching Playbooks, the Core Digest and the Sources list (#225); one of them, at a version (default: its latest). */
  adminCoachingPlaybooks: "/admin/playbooks",
  adminCoachingPlaybook: (id: string, version?: number) => `/admin/playbooks/${encodeURIComponent(id)}${version ? `?version=${version}` : ""}`,
  /** One Eval Run (#231): what it played, on what, and each case's result. */
  adminEvalRun: (id: string) => `/admin/evaluations/${encodeURIComponent(id)}`,
  /** The Guardrails (Garde-fous, #228): settings and Guardrail messages for super-admins, read by Support, with their Guardrail Triggers. */
  adminGuardrails: "/admin/garde-fous",
  /**
   * The Signalements (#376): « à traiter » by default, oldest first, or of one type (`type`) or status (`statut`: a
   * status, or « tous »); and one of them.
   */
  adminSignalements: (filter: { type?: string; status?: string } = {}) => {
    const query = new URLSearchParams({ ...(filter.type ? { type: filter.type } : {}), ...(filter.status ? { statut: filter.status } : {}) }).toString();
    return `/admin/signalements${query ? `?${query}` : ""}`;
  },
  adminSignalement: (id: string) => `/admin/signalements/${encodeURIComponent(id)}`,
  /** « Questions sans réponse » (#344): the open Unanswered Questions, of one page (`route`, a route pattern) or language, or all. */
  adminUnansweredQuestions: (filter: { route?: string; language?: string } = {}) => {
    const query = new URLSearchParams({ ...(filter.route ? { page: filter.route } : {}), ...(filter.language ? { langue: filter.language } : {}) }).toString();
    return `/admin/questions-sans-reponse${query ? `?${query}` : ""}`;
  },
  /** The Job discovery sources: Paramètres' Sources tab (#396); Job discovery sites are on Recherche web, Job Sites on Extension. */
  adminSearchSites: "/admin/parametres?tab=sources",
  /** The Tools (Outils, #233): every external tool the app calls, and one Tool's latest calls; super-admins and Support. */
  adminTools: "/admin/outils",
  adminTool: (id: string) => `/admin/outils/${encodeURIComponent(id)}`,
  /**
   * The Platform Settings (Paramètres, #298), in tabs by kind of Tool (#396): super-admins and Support. A tab's address,
   * a setting's row and a provider's sheet are said by platform-settings/parametres.ts. The Provider Secrets are on each
   * provider's sheet there (formerly Clés).
   */
  adminPlatformSettings: "/admin/parametres",
  /** The Sign-in Providers and Require SSO for Administrators: Paramètres' Connexion tab (#396, formerly Connexion). */
  adminSignInProviders: "/admin/parametres?tab=connexion",
  /** The AI consumption report (Consommation IA), over a period ("7d", "2026-09"...): super-admins and Support. */
  adminAiUsage: (period?: string) => (period ? `/admin/consommation-ia?periode=${encodeURIComponent(period)}` : "/admin/consommation-ia"),
  /**
   * Back Office Activity (« Activité », #404, ADR-0042): one page, a tab each for Recherches (the Job discovery runs),
   * Emails reçus (#449), Appels IA (the AI Message Log) and Actions des administrateurs (the Back Office Audit). Its own address opens the
   * first tab the Administrator may read.
   */
  adminActivity: "/admin/activite",
  /** Recherches: every Job discovery run, filtered (`declencheur`, `periode`, `secours`), and one run's panel (`run`); super-admins, Technique and Support. */
  adminDiscoveryRuns: (filter: { trigger?: string; period?: string; fallback?: boolean; run?: string } = {}) => {
    const query = new URLSearchParams({
      ...(filter.trigger ? { declencheur: filter.trigger } : {}),
      ...(filter.period ? { periode: filter.period } : {}),
      ...(filter.fallback ? { secours: "1" } : {}),
      ...(filter.run ? { run: filter.run } : {}),
    }).toString();
    return `/admin/activite/recherches${query ? `?${query}` : ""}`;
  },
  /** Emails reçus (#449): every Received offer email of Email intake, filtered (`resultat`, `type`, `periode`); no Candidate named; super-admins, Technique and Support. */
  adminReceivedEmails: (filter: { outcome?: string; kind?: string; period?: string } = {}) => {
    const query = new URLSearchParams({
      ...(filter.outcome ? { resultat: filter.outcome } : {}),
      ...(filter.kind ? { type: filter.kind } : {}),
      ...(filter.period ? { periode: filter.period } : {}),
    }).toString();
    return `/admin/activite/emails-recus${query ? `?${query}` : ""}`;
  },
  /** The Job Search behind a run: super-admins only, each opening written to the Back Office Audit. */
  adminDiscoveryRunJobSearch: (runId: string) => `/admin/activite/recherches/${encodeURIComponent(runId)}/recherche`,
  /** Appels IA (the AI Message Log, formerly Journaux IA): the list, filtered, or one call; super-admins only, every call opened is audited. */
  adminAiMessages: (filter?: Record<string, string>) => {
    const query = new URLSearchParams(Object.entries(filter ?? {}).filter(([, value]) => value)).toString();
    return query ? `/admin/activite/appels-ia?${query}` : "/admin/activite/appels-ia";
  },
  adminAiMessage: (id: string) => `/admin/activite/appels-ia/${encodeURIComponent(id)}`,
  /** Administrators and their Back Office Roles. */
  /** The Design System page (#463): every token and component, in either theme and Density; every Back Office Role reads it. */
  adminDesignSystem: "/admin/design-system",
  adminAdministrators: "/admin/administrateurs",
  /**
   * Actions des administrateurs (the Back Office Audit, formerly Journal), newest first; with a section, only its changes;
   * with an Outcome, only the succeeded or the failed.
   */
  adminAudit: (filter: { section?: string; outcome?: string } = {}) => {
    const query = new URLSearchParams(Object.entries(filter).filter((entry): entry is [string, string] => Boolean(entry[1]))).toString();
    return query ? `/admin/activite/actions?${query}` : "/admin/activite/actions";
  },
} as const;
