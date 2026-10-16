/** Paths of the web app's pages. French, like the interface default. */
export const routes = {
  home: "/",
  signIn: "/connexion",
  account: "/compte",
  newProfile: "/profils/nouveau",
  profile: (id: string) => `/profils/${id}`,
  /** The Job Search section of a Profile's page. */
  profileJobSearch: (id: string) => `/profils/${id}#job-search-title`,
  /** The Search Criteria of a Profile's page. */
  profileSearchCriteria: (id: string) => `/profils/${id}#search-criteria-title`,
  /** The Job Digest section of a Profile's page. */
  profileJobDigest: (id: string) => `/profils/${id}#job-digest-title`,
  editMasterCv: (id: string) => `/profils/${id}/cv`,
  masterCvVersions: (id: string) => `/profils/${id}/versions`,
  applications: "/candidatures",
  applicationsBoard: "/candidatures?vue=tableau",
  application: (id: string) => `/candidatures/${id}`,
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
  adminPlanQuotas: "/admin/quotas",
  adminHumanCoaches: "/admin/coachs",
  /** The AI Coach's cost per reply, per day: median and p90 against the target. */
  adminCoachCost: "/admin/cout-coach",
  /** Administrators and their Back Office Roles. */
  adminAdministrators: "/admin/administrateurs",
  /** The Back Office Audit, newest first; with a section, only its changes. */
  adminJournal: (section?: string) => (section ? `/admin/journal?section=${encodeURIComponent(section)}` : "/admin/journal"),
} as const;
