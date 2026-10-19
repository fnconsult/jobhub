/** The Sections of a Profile's page, in order (ADR-0024). */
export const PROFILE_SECTIONS = ["propositions", "cv-de-reference", "ats-score", "job-digest", "telecharger", "gerer"] as const;
export type ProfileSection = (typeof PROFILE_SECTIONS)[number];

/** The Sections of an Application's page, in order (ADR-0024). */
export const APPLICATION_SECTIONS = ["propositions", "documents", "correspondance", "entretiens", "avis", "dossier", "contacts", "offre"] as const;
export type ApplicationSection = (typeof APPLICATION_SECTIONS)[number];

/** Paths of the web app's pages. French, like the interface default. */
export const routes = {
  home: "/",
  signIn: "/connexion",
  /** The Back Office sign-in: the providers allowed for Administrators; where Require SSO sends an Administrator. */
  backOfficeSignIn: "/connexion/back-office",
  account: "/compte",
  /** Mon compte's Sections (ADR-0024); `account` itself shows the first, the Profiles. */
  accountProfiles: "/compte/profils",
  accountFollowUps: "/compte/relances",
  accountEuAi: "/compte/ia-europeenne",
  accountSignIn: "/compte/connexion",
  accountPreferences: "/compte/preferences",
  accountTools: "/compte/outils",
  accountData: "/compte/donnees",
  newProfile: "/profils/nouveau",
  profile: (id: string) => `/profils/${id}`,
  /** The Job Search section of a Profile's page. */
  profileJobSearch: (id: string) => `/profils/${id}#job-search-title`,
  /** The Search Criteria of a Profile's page. */
  profileSearchCriteria: (id: string) => `/profils/${id}#search-criteria-title`,
  /** The Job Digest Section of a Profile's page. */
  profileJobDigest: (id: string) => `/profils/${id}/job-digest`,
  /** A Section of a Profile's page (ADR-0024); `profile` itself shows the first one there is. */
  profileSection: (id: string, section: ProfileSection) => `/profils/${id}/${section}`,
  editMasterCv: (id: string) => `/profils/${id}/cv`,
  masterCvVersions: (id: string) => `/profils/${id}/versions`,
  applications: "/candidatures",
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
  /** The Candidate's Human Coaches: Coaching Sessions and Coach Access. */
  coaching: "/coachs",
  /** A Human Coach's own pages: the Candidates who granted them Coach Access. */
  coachSpace: "/espace-coach",
  coachSpaceCandidate: (candidateId: string) => `/espace-coach/${encodeURIComponent(candidateId)}`,
  coachSpaceApplication: (candidateId: string, applicationId: string) => `/espace-coach/${encodeURIComponent(candidateId)}/candidatures/${applicationId}`,
  accountDeleted: "/compte/supprime",
  /** Where a Job Digest email's unsubscribe link leads (no sign-in needed). */
  jobDigestUnsubscribe: "/desabonnement",
  admin: "/admin",
  /** The Plans (Offres): names, rank, offered or hidden, Stripe product, Plan Features. */
  adminPlans: "/admin/offres",
  adminPlanQuotas: "/admin/quotas",
  /** Coupons (Codes promo): Stripe promotion codes, Plans managers. */
  adminCoupons: "/admin/codes-promo",
  adminHumanCoaches: "/admin/coachs",
  /** The AI Coach's cost per reply, per day: median and p90 against the target. */
  adminCoachCost: "/admin/cout-coach",
  /** The Coaching Playbooks, the Core Digest and the Sources list (#225); one of them, at a version (default: its latest). */
  adminCoachingPlaybooks: "/admin/playbooks",
  adminCoachingPlaybook: (id: string, version?: number) => `/admin/playbooks/${encodeURIComponent(id)}${version ? `?version=${version}` : ""}`,
  /** The sites Jobbbox searches: the extension's Job Sites, Job discovery sources and Job discovery sites. */
  adminSearchSites: "/admin/sites",
  /** The Provider Secrets (Clés): third-party keys, super-admins only. */
  adminProviderSecrets: "/admin/cles",
  /** The Sign-in Providers (Connexion) and Require SSO for Administrators, super-admins only. */
  adminSignInProviders: "/admin/connexion",
  /** The AI consumption report (Consommation IA), over a period ("7d", "2026-09"...): super-admins and Support. */
  adminAiUsage: (period?: string) => (period ? `/admin/consommation-ia?periode=${encodeURIComponent(period)}` : "/admin/consommation-ia"),
  /** The AI Message Log (Journaux IA): the list, filtered, or one log; super-admins only, every log read is audited. */
  adminAiMessages: (filter?: Record<string, string>) => {
    const query = new URLSearchParams(Object.entries(filter ?? {}).filter(([, value]) => value)).toString();
    return query ? `/admin/journaux-ia?${query}` : "/admin/journaux-ia";
  },
  adminAiMessage: (id: string) => `/admin/journaux-ia/${encodeURIComponent(id)}`,
  /** Administrators and their Back Office Roles. */
  adminAdministrators: "/admin/administrateurs",
  /** The Back Office Audit, newest first; with a section, only its changes. */
  adminJournal: (section?: string) => (section ? `/admin/journal?section=${encodeURIComponent(section)}` : "/admin/journal"),
} as const;
