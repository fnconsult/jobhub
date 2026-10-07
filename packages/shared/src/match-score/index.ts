/**
 * Match Score: how well a CV (Master or Tailored) fits a Job Offer, 0–100,
 * with an explained breakdown. Pure and synchronous, so the web app and the
 * extension's Guest flow compute it the same way, without an account.
 */
import type { ContractType, CvContent, JobOfferDetails, SalaryRange, SearchCriteria } from "../domain";

export type CriterionStatus = "match" | "partial" | "mismatch" | "unknown";

export interface SkillsBreakdown {
  status: CriterionStatus;
  /** The Job Offer's skills the CV shows, as the Job Offer writes them. */
  covered: string[];
  /** The Job Offer's skills the CV does not show. */
  missing: string[];
}

export interface SeniorityBreakdown {
  status: CriterionStatus;
  /** Years from the CV's earliest dated job to its latest (today for a current job). */
  cvYears?: number;
  /** Years of experience the Job Offer asks for. */
  requiredYears?: number;
}

/** One criterion compared with the Search Criteria: what the Job Offer says, and what is wanted. */
export interface CriterionBreakdown<T> {
  status: CriterionStatus;
  offer?: T;
  wanted?: T;
}

/** The Job Offer's salary range against the Search Criteria's minimum salary. */
export interface SalaryBreakdown {
  status: CriterionStatus;
  offer?: SalaryRange;
  wanted?: number;
}

export interface MatchScore {
  score: number;
  breakdown: {
    skills: SkillsBreakdown;
    seniority: SeniorityBreakdown;
    location: CriterionBreakdown<string>;
    salary: SalaryBreakdown;
    contractType: CriterionBreakdown<ContractType>;
  };
}

export interface MatchInput {
  cv: CvContent;
  jobOffer: JobOfferDetails;
  /** The Profile's Search Criteria; for a Guest without them, the CV's own location is used. */
  searchCriteria?: SearchCriteria;
  /** For a current job ("2015 – aujourd'hui"). Defaults to now. */
  today?: Date;
}

/** Lower case, without accents or punctuation, single-spaced: "Trésorerie" → "tresorerie". */
function normalise(text: string): string {
  return ` ${text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#]+/gu, " ")
    .trim()} `;
}

function cvText(cv: CvContent): string {
  return normalise(
    [
      cv.headline,
      cv.summary,
      ...cv.skills,
      ...cv.experience.flatMap((job) => [job.title, job.description]),
      ...cv.education.map((item) => item.degree),
    ].join(" | "),
  );
}

function scoreSkills(cv: CvContent, jobOffer: JobOfferDetails): SkillsBreakdown {
  const text = cvText(cv);
  const wanted = jobOffer.skills ?? [];
  const covered = wanted.filter((skill) => text.includes(normalise(skill)));
  const missing = wanted.filter((skill) => !covered.includes(skill));
  const status: CriterionStatus =
    wanted.length === 0 ? "unknown" : missing.length === 0 ? "match" : covered.length === 0 ? "mismatch" : "partial";
  return { status, covered, missing };
}

/** A period that runs to today: "2015 – présent", or one that only says when it began ("Depuis 2015", "Since 2015"). */
const ONGOING = /aujourd|present|actuel|en cours|ce jour|now|current|today|depuis|since/;

function cvYears(cv: CvContent, today: Date): number | undefined {
  const years: number[] = [];
  for (const { period } of cv.experience) {
    const text = normalise(period);
    years.push(...[...text.matchAll(/\b(19|20)\d{2}\b/g)].map((match) => Number(match[0])));
    if (ONGOING.test(text)) years.push(today.getFullYear());
  }
  return years.length === 0 ? undefined : Math.max(...years) - Math.min(...years);
}

const REQUIRED_YEARS = [/(\d{1,2}) ?\+? ?ans? (?:minimum )?d ?(?:experience|exp)/, /(\d{1,2}) ?\+? ?years? (?:of )?(?:relevant |professional )?experience/];

function requiredYears(jobOffer: JobOfferDetails): number | undefined {
  if (jobOffer.requiredExperienceYears !== undefined) return jobOffer.requiredExperienceYears;
  const text = normalise(jobOffer.content);
  for (const pattern of REQUIRED_YEARS) {
    const match = text.match(pattern);
    if (match) return Number(match[1]);
  }
  return undefined;
}

function scoreSeniority(cv: CvContent, jobOffer: JobOfferDetails, today: Date): SeniorityBreakdown {
  const breakdown: SeniorityBreakdown = { status: "unknown" };
  const has = cvYears(cv, today);
  const wanted = requiredYears(jobOffer);
  if (has !== undefined) breakdown.cvYears = has;
  if (wanted !== undefined) breakdown.requiredYears = wanted;
  if (has !== undefined && wanted !== undefined) {
    breakdown.status = has >= wanted ? "match" : has >= wanted * 0.75 ? "partial" : "mismatch";
  }
  return breakdown;
}

/** Compares what the Job Offer says with what is wanted; unknown when either is missing. */
function compare<T>(offer: T | undefined, wanted: T | undefined, status: (offer: T, wanted: T) => CriterionStatus): CriterionBreakdown<T> {
  const breakdown: CriterionBreakdown<T> = { status: "unknown" };
  if (offer !== undefined) breakdown.offer = offer;
  if (wanted !== undefined) breakdown.wanted = wanted;
  if (offer !== undefined && wanted !== undefined) breakdown.status = status(offer, wanted);
  return breakdown;
}

const blankToUndefined = (text: string | undefined) => (text?.trim() ? text.trim() : undefined);

function scoreLocation(cv: CvContent, jobOffer: JobOfferDetails, searchCriteria: SearchCriteria | undefined) {
  return compare(blankToUndefined(jobOffer.location), blankToUndefined(searchCriteria?.location ?? cv.location), (offer, wanted) => {
    if (jobOffer.remoteWork === "full_remote") return "match";
    const [a, b] = [normalise(offer), normalise(wanted)];
    return a.includes(b) || b.includes(a) ? "match" : "mismatch";
  });
}

function scoreSalary(jobOffer: JobOfferDetails, searchCriteria: SearchCriteria | undefined): SalaryBreakdown {
  const range = jobOffer.salary?.min !== undefined || jobOffer.salary?.max !== undefined ? jobOffer.salary : undefined;
  const breakdown: SalaryBreakdown = { status: "unknown" };
  if (range) breakdown.offer = range;
  const wanted = searchCriteria?.minSalary;
  if (wanted !== undefined) breakdown.wanted = wanted;
  if (range && wanted !== undefined) {
    const top = Math.max(range.min ?? 0, range.max ?? 0);
    breakdown.status = top >= wanted ? "match" : top >= wanted * 0.9 ? "partial" : "mismatch";
  }
  return breakdown;
}

/** How much each criterion weighs in the score, out of 100 when all are known. */
const WEIGHTS = { skills: 40, seniority: 20, location: 15, contractType: 15, salary: 10 } as const;

function fulfilment(criterion: { status: CriterionStatus }): number {
  if ("covered" in criterion && criterion.status === "partial") {
    const { covered, missing } = criterion as SkillsBreakdown;
    return covered.length / (covered.length + missing.length);
  }
  return { match: 1, partial: 0.5, mismatch: 0, unknown: 0 }[criterion.status];
}

/** The weighted share of the known criteria that the CV fulfils, 0–100; 0 when nothing is known. */
function overall(breakdown: MatchScore["breakdown"]): number {
  let earned = 0;
  let possible = 0;
  for (const name of Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]) {
    if (breakdown[name].status === "unknown") continue;
    earned += WEIGHTS[name] * fulfilment(breakdown[name]);
    possible += WEIGHTS[name];
  }
  return possible === 0 ? 0 : Math.round((earned / possible) * 100);
}

export function scoreMatch({ cv, jobOffer, searchCriteria, today = new Date() }: MatchInput): MatchScore {
  const skills = scoreSkills(cv, jobOffer);
  const seniority = scoreSeniority(cv, jobOffer, today);
  const location = scoreLocation(cv, jobOffer, searchCriteria);
  const salary = scoreSalary(jobOffer, searchCriteria);
  const contractType = compare(jobOffer.contractType, searchCriteria?.contractType, (offer, wanted) => (offer === wanted ? "match" : "mismatch"));
  const breakdown = { skills, seniority, location, salary, contractType };
  return { score: overall(breakdown), breakdown };
}
