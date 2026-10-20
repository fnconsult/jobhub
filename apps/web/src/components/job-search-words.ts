import {
  matchScoreReliability,
  wantedValues,
  type ContractType,
  type CriterionStatus,
  type MatchScore,
  type MatchScoreReliability,
  type RemoteWork,
  type SearchCriteria,
} from "@jobhub/shared";
import type { TFunction } from "i18next";

/** Values any one of which will do, in words: "Lyon ou Bordeaux", "CDI, CDD ou Intérim" (ADR-0025). */
export function anyOfInWords(values: readonly string[], locale: string): string {
  return new Intl.ListFormat(locale, { type: "disjunction" }).format(values);
}

/** The contract types wanted, in words ("CDI ou Indépendant (freelance)"); "" for none. */
export function contractTypesInWords(contractTypes: readonly ContractType[], t: TFunction, locale: string): string {
  return anyOfInWords(contractTypes.map((type) => t(`cvReview.contractTypes.${type}`)), locale);
}

/** The remote-work options wanted, in words ("Hybride ou Télétravail complet"); "" for none. */
export function remoteWorkOptionsInWords(options: readonly RemoteWork[], t: TFunction, locale: string): string {
  return anyOfInWords(options.map((option) => t(`cvReview.remoteWorkOptions.${option}`)), locale);
}

/**
 * A Profile's Search Criteria in one line ("Lyon ou Bordeaux · CDI ou Indépendant
 * (freelance) · 85 000 € brut par an minimum · Télétravail : Hybride"), leaving out
 * what the Candidate did not specify. The target role is not repeated: the Job
 * Search page names it.
 */
export function searchCriteriaInWords(criteria: SearchCriteria, t: TFunction, locale: string): string {
  const parts = [anyOfInWords(criteria.locations, locale)];
  if (criteria.contractTypes.length > 0) parts.push(contractTypesInWords(criteria.contractTypes, t, locale));
  if (criteria.minSalary !== undefined) parts.push(t("profile.salary", { amount: new Intl.NumberFormat(locale).format(criteria.minSalary) }));
  if (criteria.remoteWorkOptions.length > 0) parts.push(t("jobSearch.remoteWork", { option: remoteWorkOptionsInWords(criteria.remoteWorkOptions, t, locale) }));
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
    reason(location.status, offerAndWanted("location", location.offer, anyOfInWords(wantedValues(location), locale))),
    reason(salary.status, salaryText),
    reason(
      contractType.status,
      offerAndWanted("contractType", contractType.offer && contract(contractType.offer), anyOfInWords(wantedValues(contractType).map(contract), locale)),
    ),
  ];
}

/** What a page needs to show a Match Score's value: plain data, so a client component can take it. */
export interface MatchScoreFigure {
  score: number;
  reliability: MatchScoreReliability;
  /** How many of the 5 criteria could be compared. */
  known: number;
}

export function matchScoreFigure(matchScore: MatchScore): MatchScoreFigure {
  const known = Object.values(matchScore.breakdown).filter((criterion) => criterion.status !== "unknown").length;
  return { score: matchScore.score, reliability: matchScoreReliability(matchScore), known };
}

/** "72 / 100", "100 / 100, partiel" or "Non calculable" (#94): never 0 / 100 for a score with nothing to compare. */
export function matchScoreInWords({ score, reliability }: MatchScoreFigure, t: TFunction): string {
  if (reliability === "not_computable") return t("matchScore.notComputable");
  return t(reliability === "partial" ? "matchScore.partialScore" : "matchScore.score", { score });
}

/** "Pourquoi 72 ?", or "Pourquoi pas de score ?" when it is not computable. */
export function matchScoreWhyInWords({ score, reliability }: MatchScoreFigure, t: TFunction): string {
  return reliability === "not_computable" ? t("jobSearch.whyNotComputable") : t("jobSearch.why", { score });
}

/** What to know before trusting a partial or not computable Match Score; null for a reliable one. */
export function matchScoreReliabilityHint({ reliability, known }: MatchScoreFigure, t: TFunction): string | null {
  if (reliability === "not_computable") return t("matchScore.notComputableHint");
  if (reliability === "partial") return t("matchScore.partialHint", { count: known });
  return null;
}
