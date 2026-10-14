import type { ContractType, CriterionStatus, MatchScore, SearchCriteria } from "@jobhub/shared";
import type { TFunction } from "i18next";

/**
 * A Profile's Search Criteria in one line ("Lyon · CDI · 85 000 € brut par an
 * minimum · Télétravail : Hybride"), leaving out what the Candidate did not
 * specify. The target role is not repeated: the Job Search page names it.
 */
export function searchCriteriaInWords(criteria: SearchCriteria, t: TFunction, locale: string): string {
  const parts = [criteria.location.trim()];
  if (criteria.contractType) parts.push(t(`cvReview.contractTypes.${criteria.contractType}`));
  if (criteria.minSalary !== undefined) parts.push(t("profile.salary", { amount: new Intl.NumberFormat(locale).format(criteria.minSalary) }));
  if (criteria.remoteWork) parts.push(t("jobSearch.remoteWork", { option: t(`cvReview.remoteWorkOptions.${criteria.remoteWork}`) }));
  return parts.filter(Boolean).join(" · ");
}

/** One line of "Why 86?": a Match Score criterion's verdict, and what the Job Offer and the Candidate say. */
export interface MatchScoreReason {
  status: CriterionStatus;
  /** "Correspond", "En partie", "Ne correspond pas" or "Non comparable". */
  verdict: string;
  text: string;
}

/**
 * Why a Job Offer has its Match Score, in the order of its criteria (skills,
 * experience, location, salary, contract). A criterion with nothing to compare
 * is named alone, its verdict saying it is not comparable.
 */
export function matchScoreReasons(matchScore: MatchScore, t: TFunction, locale: string): MatchScoreReason[] {
  const { skills, seniority, location, salary, contractType } = matchScore.breakdown;
  const amount = (value: number) => new Intl.NumberFormat(locale).format(value);
  const contract = (value: ContractType) => t(`cvReview.contractTypes.${value}`);
  const criterion = (name: "skills" | "seniority" | "location" | "salary" | "contractType") => t(`matchScore.criteria.${name}`);
  const offerAndWanted = (name: "location" | "contractType", offer: string | undefined, wanted: string | undefined) =>
    offer && wanted ? t("jobSearch.reasons.offerAndWanted", { criterion: criterion(name), offer, wanted }) : criterion(name);
  const reason = (status: CriterionStatus, text: string): MatchScoreReason => ({ status, verdict: t(`matchScore.statuses.${status}`), text });

  const total = skills.covered.length + skills.missing.length;
  const skillsText =
    total === 0
      ? criterion("skills")
      : skills.missing.length > 0
        ? t("jobSearch.reasons.skillsWithMissing", { covered: skills.covered.length, total, missing: skills.missing.join(", ") })
        : t("jobSearch.reasons.skills", { covered: skills.covered.length, total });
  const seniorityText =
    seniority.cvYears !== undefined && seniority.requiredYears !== undefined
      ? t("jobSearch.reasons.seniority", { cvYears: seniority.cvYears, requiredYears: seniority.requiredYears })
      : criterion("seniority");
  const offeredSalary = salary.offer ? [salary.offer.min, salary.offer.max].filter((value) => value !== undefined).map(amount).join(" – ") : "";
  const salaryText =
    offeredSalary && salary.wanted !== undefined ? t("jobSearch.reasons.salary", { offer: offeredSalary, wanted: amount(salary.wanted) }) : criterion("salary");

  return [
    reason(skills.status, skillsText),
    reason(seniority.status, seniorityText),
    reason(location.status, offerAndWanted("location", location.offer, location.wanted)),
    reason(salary.status, salaryText),
    reason(
      contractType.status,
      offerAndWanted("contractType", contractType.offer && contract(contractType.offer), contractType.wanted && contract(contractType.wanted)),
    ),
  ];
}
