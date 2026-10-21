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

/**
 * Application Statuses at which the Candidate is no longer applying: the end
 * states, and Acceptée (the Candidate took the job). Any other is ongoing.
 */
export const FINAL_APPLICATION_STATUSES = ["accepted", "rejected", "abandoned"] as const satisfies readonly ApplicationStatus[];

/**
 * The subscription tier a Candidate is on, by its permanent key ("free", "standard",
 * "premium", or one an Administrator created in the Back Office). Plans live in the
 * database (the `plan` table): a key is only a Plan once that table holds it.
 */
export type Plan = string;

/** The Plan every Candidate starts on: built in, always ranked first, never paid through Stripe. */
export const FREE_PLAN = "free" satisfies Plan;

/** Whether a Plan is shown in the plan comparison, at checkout and in Upgrade Prompts (offered), or not (hidden). */
export const PLAN_STATUSES = ["offered", "hidden"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

/**
 * Plan Features: what a Plan switches on or off, beyond its countable Plan Quotas.
 * A fixed set in code; Administrators choose which of them each Plan has.
 */
export const PLAN_FEATURES = ["coachingSessionDiscount"] as const;
export type PlanFeature = (typeof PLAN_FEATURES)[number];

/** Plan Quotas that cap a number of things: Profiles held at once, or uses per week. */
export const LIMITED_QUOTAS = ["profiles", "matchScores", "atsScores", "enrichedContacts", "jobSearches"] as const;
export type LimitedQuota = (typeof LIMITED_QUOTAS)[number];

/**
 * Limited Plan Quotas counted per week, from Monday 00:00 in Europe/Paris (ADR-0032);
 * the others count what the Candidate holds.
 */
export const WEEKLY_QUOTAS = ["matchScores", "atsScores", "enrichedContacts", "jobSearches"] as const satisfies readonly LimitedQuota[];
export type WeeklyQuota = (typeof WEEKLY_QUOTAS)[number];

/** How often a Candidate receives a Job Digest. */
export const JOB_DIGEST_FREQUENCIES = ["none", "weekly", "daily"] as const;
export type JobDigestFrequency = (typeof JOB_DIGEST_FREQUENCIES)[number];

/** The Plan Quotas of one Plan. A null limit means unlimited. */
export type PlanQuotas = { [quota in LimitedQuota]: number | null } & { jobDigest: JobDigestFrequency };

/** Contract types a Candidate can search for (French market). */
export const CONTRACT_TYPES = ["cdi", "cdd", "freelance", "interim"] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];

/** How much remote work a Candidate wants. */
export const REMOTE_WORK_OPTIONS = ["on_site", "hybrid", "full_remote"] as const;
export type RemoteWork = (typeof REMOTE_WORK_OPTIONS)[number];

/** How many locations a Profile's Search Criteria hold at most (ADR-0025). */
export const MAX_SEARCH_LOCATIONS = 5;

/**
 * The job-search parameters of a Profile: one target role and one minimum salary,
 * several locations, contract types and remote-work options (ADR-0025). A Job
 * Offer meets a criterion as soon as it meets one of its values; an empty list
 * of contract types or remote-work options means no preference.
 */
export interface SearchCriteria {
  targetRole: string;
  /** One to `MAX_SEARCH_LOCATIONS` places, trimmed, each named once. */
  locations: string[];
  /** Minimum gross annual salary, in euros. */
  minSalary?: number;
  /** Any of them will do; none means no preference. */
  contractTypes: ContractType[];
  /** Any of them will do; none means no preference. */
  remoteWorkOptions: RemoteWork[];
  /** Sectors: NAF rév. 2 sections ("C"), any of which will do; none means no preference (./sectors.ts). */
  sectors: string[];
  /** Subsectors: NAF rév. 2 divisions ("29"), each within one of the `sectors`. */
  subsectors: string[];
  /** Domains: ROME 4.0 professional domains ("M13"), any of which will do; none means no preference. */
  domains: string[];
}

/** What two places are compared by: trimmed, without case or accents ("Île-de-France" is "ile-de-france"). */
export function locationKey(location: string): string {
  return location.trim().normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/**
 * Locations as Search Criteria keep them: trimmed, blanks dropped, each place
 * once (compared without case or accents), in the order given.
 */
export function distinctLocations(locations: readonly string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const raw of locations) {
    const location = raw.trim();
    const key = locationKey(location);
    if (!location || seen.has(key)) continue;
    seen.add(key);
    kept.push(location);
  }
  return kept;
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
  /**
   * True when the CV shows a picture, most likely the Candidate's photo: found
   * in the uploaded file, or set by the Candidate. Absent means no photo.
   * The Master CV keeps no picture itself, only this fact (Senior Advice).
   */
  photo?: boolean;
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
  /**
   * The Posting date: when the source first published the posting, set only
   * when Job discovery read it from the source itself (an ATS's own API, e.g.
   * Greenhouse's `first_published`, the page's JobPosting `datePosted`, or the
   * search provider's date for the page). Unset means the date is unknown.
   */
  postedAt?: Date;
  /**
   * The Job Offer Summary: two or three sentences on the role, its scope and what
   * is expected, written by the AI from the offer's own text and in its language,
   * inventing nothing (ADR-0006). Unset until it is read (or when the AI gave none).
   */
  summary?: string;
  /**
   * The employer's sector (e.g. "Conseil") and, finer, its sub-sector or domain (e.g. "Stratégie et
   * transformation"), read by the AI from the offer's text with the summary. Unset when it says nothing of it.
   */
  sector?: string;
  subsector?: string;
}

/** The longest sector or sub-sector kept, in characters. */
export const JOB_OFFER_SECTOR_MAX_CHARS = 80;

/** The longest Job Offer Summary kept, in characters: the AI is asked for about 400. */
export const JOB_OFFER_SUMMARY_MAX_CHARS = 600;

/** A Job Offer as stored: shared by every Candidate and Guest who captures the same posting. */
export interface JobOffer extends JobOfferDetails {
  id: string;
  /** Where the posting was captured: its URL, and the site's name (its host when not given). */
  source: { url?: string; name?: string };
  /**
   * Set once it is an Expired Job Offer: when a re-check found its source no
   * longer publishing it. Its Applications are flagged, never changed.
   */
  expiredAt?: Date;
}

/**
 * How long a Guest's CV and captured Job Offer are kept, at most, in hours.
 * ADR-0003 promises deletion within 24 hours; the hour left over is margin for
 * the clean-up, which runs every 15 minutes.
 */
export const GUEST_RETENTION_HOURS = 23;
