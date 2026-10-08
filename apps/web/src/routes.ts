/** Paths of the web app's pages. French, like the interface default. */
export const routes = {
  home: "/",
  signIn: "/connexion",
  account: "/compte",
  newProfile: "/profils/nouveau",
  profile: (id: string) => `/profils/${id}`,
  editMasterCv: (id: string) => `/profils/${id}/cv`,
  masterCvVersions: (id: string) => `/profils/${id}/versions`,
  applications: "/candidatures",
  applicationsBoard: "/candidatures?vue=tableau",
  application: (id: string) => `/candidatures/${id}`,
  jobOffer: (id: string) => `/offres/${id}`,
  jobSearch: (id: string) => `/recherches/${id}`,
  masterCvVersion: (id: string, version: number) => `/profils/${id}/versions/${version}`,
  subscription: "/abonnement",
  /** Where a Job Digest email's unsubscribe link leads (no sign-in needed). */
  jobDigestUnsubscribe: "/desabonnement",
  admin: "/admin",
  adminPlanQuotas: "/admin/quotas",
} as const;
