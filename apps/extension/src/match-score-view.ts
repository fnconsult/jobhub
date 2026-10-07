import type { CriterionStatus, MatchScore } from "@jobhub/shared";
import type { createI18n } from "@jobhub/shared/i18n";

type Translate = ReturnType<typeof createI18n>["t"];

export interface CriterionView {
  label: string;
  status: string;
  details: string[];
}

const CRITERIA = ["skills", "seniority", "location", "salary", "contractType"] as const;

/** A Match Score as the Guest reads it: the score, then each criterion with its status and what was compared. */
export function describeMatchScore(matchScore: MatchScore, t: Translate): { score: string; criteria: CriterionView[] } {
  const { breakdown } = matchScore;
  const details: Record<(typeof CRITERIA)[number], string[]> = {
    skills: [
      ...(breakdown.skills.covered.length ? [t("extension.analysis.covered", { skills: breakdown.skills.covered.join(", ") })] : []),
      ...(breakdown.skills.missing.length ? [t("extension.analysis.missing", { skills: breakdown.skills.missing.join(", ") })] : []),
    ],
    seniority:
      breakdown.seniority.cvYears !== undefined && breakdown.seniority.requiredYears !== undefined
        ? [t("extension.analysis.years", { cv: breakdown.seniority.cvYears, required: breakdown.seniority.requiredYears })]
        : [],
    location: breakdown.location.status !== "unknown" && breakdown.location.offer ? [breakdown.location.offer] : [],
    salary: [],
    contractType: [],
  };
  return {
    score: t("extension.analysis.score", { score: matchScore.score }),
    criteria: CRITERIA.map((name) => ({
      label: t(`extension.analysis.criteria.${name}`),
      status: t(`extension.analysis.status.${breakdown[name].status satisfies CriterionStatus}`),
      details: details[name],
    })),
  };
}
