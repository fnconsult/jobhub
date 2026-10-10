import type { CriterionStatus, MatchScore, SalaryRange } from "@jobhub/shared";
import type { createI18n } from "@jobhub/shared/i18n";

type I18n = Pick<ReturnType<typeof createI18n>, "t" | "language">;

export interface CriterionView {
  label: string;
  status: string;
  details: string[];
}

const CRITERIA = ["skills", "seniority", "location", "salary", "contractType"] as const;
type Criterion = (typeof CRITERIA)[number];

/**
 * Which side left a criterion "unknown". The Match Score cannot compare when
 * either side is missing: the Job Offer's (it does not say), the CV's, or the
 * person's preference (their Search Criteria; a Guest usually has none).
 */
function missingSide(name: Criterion, breakdown: MatchScore["breakdown"]): "offer" | "cv" | "preference" {
  if (name === "skills") return "offer";
  if (name === "seniority") return breakdown.seniority.requiredYears === undefined ? "offer" : "cv";
  return breakdown[name].offer === undefined ? "offer" : "preference";
}

const UNKNOWN_STATUS = { offer: "unknown", cv: "notInCv", preference: "noPreference" } as const;

/** A Match Score as the Guest reads it: the score, then each criterion with its status and what was compared. */
export function describeMatchScore(matchScore: MatchScore, { t, language }: I18n): { score: string; criteria: CriterionView[] } {
  const { breakdown } = matchScore;
  const { seniority, location, salary, contractType } = breakdown;
  const euros = (amount: number) => new Intl.NumberFormat(language, { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(amount);
  const salaryRange = ({ min, max }: SalaryRange) => {
    if (min !== undefined && max !== undefined && min !== max) return t("extension.analysis.salary.range", { min: euros(min), max: euros(max) });
    if (min !== undefined && max !== undefined) return t("extension.analysis.salary.exactly", { amount: euros(min) });
    if (min !== undefined) return t("extension.analysis.salary.from", { amount: euros(min) });
    return t("extension.analysis.salary.upTo", { amount: euros(max!) });
  };

  const details: Record<Criterion, string[]> = {
    skills: [
      ...(breakdown.skills.covered.length ? [t("extension.analysis.covered", { skills: breakdown.skills.covered.join(", ") })] : []),
      ...(breakdown.skills.missing.length ? [t("extension.analysis.missing", { skills: breakdown.skills.missing.join(", ") })] : []),
    ],
    seniority:
      seniority.requiredYears === undefined
        ? []
        : seniority.cvYears === undefined
          ? [t("extension.analysis.offerYears", { required: seniority.requiredYears })]
          : [t("extension.analysis.years", { cv: seniority.cvYears, required: seniority.requiredYears })],
    location: location.offer ? [location.offer] : [],
    salary: [
      ...(salary.offer ? [t("extension.analysis.offer", { value: salaryRange(salary.offer) })] : []),
      ...(salary.wanted !== undefined ? [t("extension.analysis.salary.wanted", { amount: euros(salary.wanted) })] : []),
    ],
    contractType: contractType.offer ? [t("extension.analysis.offer", { value: t(`cvReview.contractTypes.${contractType.offer}`) })] : [],
  };
  return {
    score: t("extension.analysis.score", { score: matchScore.score }),
    criteria: CRITERIA.map((name) => {
      const status: CriterionStatus = breakdown[name].status;
      const key = status === "unknown" ? UNKNOWN_STATUS[missingSide(name, breakdown)] : status;
      return { label: t(`extension.analysis.criteria.${name}`), status: t(`extension.analysis.status.${key}`), details: details[name] };
    }),
  };
}

/**
 * What a rescore came to, so the Candidate sees it happened even when the value is the same (#76):
 * when it was computed, and whether the score changed from the one shown before, if any.
 */
export function describeRescore({ previous, current, at }: { previous?: MatchScore; current: MatchScore; at: Date }, { t, language }: I18n): string {
  const time = new Intl.DateTimeFormat(language, { timeStyle: "short" }).format(at);
  if (!previous) return t("extension.analysis.rescored", { time });
  if (previous.score === current.score) return t("extension.analysis.rescoredUnchanged", { time });
  return t("extension.analysis.rescoredFrom", { time, score: previous.score });
}
