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

/** One job held, as written on a CV. */
export interface CvExperience {
  title: string;
  employer: string;
  location: string;
  /** As written on the CV, e.g. "2015 – 2024". */
  period: string;
  description: string;
}

/** One diploma or training, as written on a CV. */
export interface CvEducation {
  degree: string;
  institution: string;
  year: string;
}

export interface CvLanguage {
  name: string;
  /** As written on the CV, e.g. "courant". */
  level: string;
}

/**
 * The content of one version of a Master CV, in sections. Every text field is
 * present; an empty string means the CV says nothing about it.
 */
export interface MasterCvContent {
  fullName: string;
  headline: string;
  email: string;
  phone: string;
  location: string;
  summary: string;
  experience: CvExperience[];
  education: CvEducation[];
  skills: string[];
  languages: CvLanguage[];
}

/**
 * The content of a CV in sections: a Master CV version or a Tailored CV, which
 * is a copy of the Master CV adapted to one Job Offer and has the same shape.
 */
export type CvContent = MasterCvContent;

/** A salary range, gross annual, in euros. Either end may be unknown. */
export interface SalaryRange {
  min?: number;
  max?: number;
}

/**
 * What a Job Offer says about the job, as captured from its source. Only the
 * title and the full content are always known; the rest is filled when the
 * posting states it.
 */
export interface JobOfferDetails {
  title: string;
  /** The full text of the posting. */
  content: string;
  employer?: string;
  location?: string;
  contractType?: ContractType;
  remoteWork?: RemoteWork;
  salary?: SalaryRange;
  /** Skills the posting asks for. */
  skills?: string[];
  /** Years of experience the posting asks for. */
  requiredExperienceYears?: number;
}

/** A Job Offer as stored: shared by every Candidate and Guest who captures the same posting. */
export interface JobOffer extends JobOfferDetails {
  id: string;
  /** Where the posting was captured: its URL, and the site's name (its host when not given). */
  source: { url?: string; name?: string };
}
