/**
 * Domain types shared by the web app, the extension and the worker.
 * Vocabulary: CONTEXT.md at the repo root.
 */

/** The stage an Application is at. Changed manually by the Candidate. */
export const APPLICATION_STATUSES = [
  "to_apply", // À postuler
  "applied", // Postulée
  "followed_up", // Relancée
  "interview", // Entretien
  "offer_received", // Offre reçue
  "accepted", // Acceptée
  "rejected", // Refusée (end state)
  "abandoned", // Abandonnée (end state)
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** The subscription tier a Candidate is on. */
export const PLANS = ["free", "standard", "premium"] as const;
export type Plan = (typeof PLANS)[number];

/** Contract types a Candidate can search for (French market). */
export const CONTRACT_TYPES = ["cdi", "cdd", "freelance", "interim"] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];

/** How much remote work a Candidate wants. */
export const REMOTE_WORK_OPTIONS = ["on_site", "hybrid", "full_remote"] as const;
export type RemoteWork = (typeof REMOTE_WORK_OPTIONS)[number];

/** The job-search parameters of a Profile. */
export interface SearchCriteria {
  targetRole: string;
  location: string;
  /** Minimum gross annual salary, in euros. */
  minSalary?: number;
  contractType?: ContractType;
  remoteWork?: RemoteWork;
}
