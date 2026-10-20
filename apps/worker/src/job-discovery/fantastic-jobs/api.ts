/**
 * What Fantastic.jobs' `active-ats` endpoint looks like: where to ask, what its
 * search takes, and how to read its jobs.
 *
 * From its API reference (developer.fantastic.jobs/api/new-jobs, read 2026-10-20,
 * docs/research/issue-243.md) and a real answer (fixtures/fantastic-jobs/active-ats.json).
 * Only `active-ats` (ATS postings from employers' career pages) is used: `active-jb`
 * holds LinkedIn's postings, a Forbidden site, and recruiters' personal data.
 */
import { MAX_POSTING_AGE_DAYS, type ContractType, type JobOfferDetails, type RemoteWork, type SalaryRange, type SearchCriteria } from "@jobhub/shared";

export const DEFAULT_API_URL = "https://data.fantastic.jobs/v1";
/** The most jobs one answer gives. */
export const MAX_LIMIT = 1000;

/** Fantastic.jobs' dates: an ISO instant to the second. */
const isoSeconds = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, "Z");

/**
 * The search for `criteria` near `location`, one of its locations (Job discovery searches each in turn,
 * ADR-0025; France when none): its title as a text search, posted in the last MAX_POSTING_AGE_DAYS days,
 * with its description as text, the first `max` jobs (at most MAX_LIMIT). `time_frame` is when Fantastic.jobs
 * indexed a job, its widest window, so that the Posting date alone decides. Contract types and remote work
 * are left to the Match Score: Fantastic.jobs' employment types say nothing of a CDI.
 */
export function searchParams(
  criteria: SearchCriteria,
  { max, now, location = criteria.locations[0] }: { max: number; now: Date; location?: string },
): URLSearchParams {
  return new URLSearchParams({
    title: criteria.targetRole.trim(),
    location: location?.trim() || "France",
    time_frame: "6m",
    date_posted_gte: isoSeconds(new Date(now.getTime() - MAX_POSTING_AGE_DAYS * 24 * 60 * 60 * 1000)),
    description_format: "text",
    limit: String(Math.min(Math.max(max, 1), MAX_LIMIT)),
  });
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value.trim() : undefined);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(str).filter((item) => item !== undefined) : []);
const num = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined);

/** A temporary job is a CDD, a contractor's a freelance mission; full or part time says nothing of the contract. */
function contractType(types: string[]): ContractType | undefined {
  if (types.includes("CONTRACTOR")) return "freelance";
  if (types.includes("TEMPORARY")) return "cdd";
  return undefined;
}

const REMOTE_WORK: Record<string, RemoteWork> = { "On-site": "on_site", Hybrid: "hybrid", "Remote OK": "full_remote", "Remote Solely": "full_remote" };

/** A yearly salary in euros, as a gross annual range. */
function salary(job: Json): SalaryRange | undefined {
  if (str(job.ai_salary_currency)?.toUpperCase() !== "EUR" || str(job.ai_salary_unit_text)?.toUpperCase() !== "YEAR") return undefined;
  const [min, max] = [num(job.ai_salary_min_value) ?? num(job.ai_salary_value), num(job.ai_salary_max_value)];
  const range: SalaryRange = {};
  if (min !== undefined) range.min = Math.round(min);
  if (max !== undefined) range.max = Math.round(max);
  return min === undefined && max === undefined ? undefined : range;
}

/** Its dates carry no zone: they are UTC. */
function postedAt(value: unknown): Date | undefined {
  const text = str(value);
  if (!text) return undefined;
  const time = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/.test(text) ? text : `${text}Z`);
  return Number.isFinite(time) ? new Date(time) : undefined;
}

/**
 * One job as a posting at its ATS page, or null without a URL, a title or a description. Only what a Job
 * Offer holds is read: the hiring manager's name and email (`ai_hiring_manager_*`) never are (GDPR minimisation).
 */
function readJob(job: unknown): { url: string; details: JobOfferDetails } | null {
  if (!isObject(job)) return null;
  const [url, title, content] = [str(job.url), str(job.title), str(job.description_text)];
  if (!url || !/^https?:\/\//i.test(url) || !title || !content) return null;
  const details: JobOfferDetails = { title, content };
  const employer = str(job.organization);
  if (employer) details.employer = employer;
  const location = strings(job.locations_derived)[0] ?? strings(job.locations_alt)[0];
  if (location) details.location = location;
  const contract = contractType(strings(job.ai_employment_type));
  if (contract) details.contractType = contract;
  const remoteWork = REMOTE_WORK[str(job.ai_work_arrangement) ?? ""];
  if (remoteWork) details.remoteWork = remoteWork;
  const pay = salary(job);
  if (pay) details.salary = pay;
  const skills = strings(job.ai_key_skills);
  if (skills.length > 0) details.skills = skills;
  // "0-2", "2-5", "5-10" or "10+": the least asked for.
  const years = /^(\d+)/.exec(str(job.ai_experience_level) ?? "")?.[1];
  if (years !== undefined) details.requiredExperienceYears = Number(years);
  const posted = postedAt(job.date_posted);
  if (posted) details.postedAt = posted;
  return { url, details };
}

/** The jobs of an answer that make postings, in its order. */
export function readJobs(answer: unknown): { url: string; details: JobOfferDetails }[] {
  return (Array.isArray(answer) ? answer : []).map(readJob).filter((job) => job !== null);
}
