import { criterionPoints, matchScoreReliability, wantedValues, type CriterionStatus, type MatchScore, type SalaryRange } from "@jobhub/shared";
import type { createI18n } from "@jobhub/shared/i18n";

type I18n = Pick<ReturnType<typeof createI18n>, "t" | "language">;

export interface CriterionView {
  label: string;
  /** Its points, "27 / 40", or "non précisé" when it could not be compared. */
  points: string;
  /** How full its bar is, 0–100; none when it could not be compared. */
  fill?: number;
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

/** The score alone, as a rescore recalls it: "72 / 100", "100 / 100, partiel" or "non calculable". */
function scoreValue(matchScore: MatchScore, t: I18n["t"]): string {
  const reliability = matchScoreReliability(matchScore);
  if (reliability === "not_computable") return t("extension.analysis.notComputableValue");
  return t(reliability === "partial" ? "extension.analysis.partialValue" : "extension.analysis.scoreValue", { score: matchScore.score });
}

export interface MatchScoreView {
  score: string;
  /** The value the ring is filled to; none when the Match Score is not computable. */
  ring?: number;
  notes: string[];
  criteria: CriterionView[];
  /** « Points forts : … » and « À renforcer : … », each when it names something. */
  strengthsAndGaps: string[];
}

/**
 * A Match Score as the Guest reads it: the score (and the ring's value), what to know before trusting it (#94: a partial
 * or not computable score, or an offer text that could not be read), then each criterion with
 * its points, as a bar, its status and what was compared; and, in a line or two, its strengths and gaps.
 */
export function describeMatchScore(matchScore: MatchScore, { t, language }: I18n): MatchScoreView {
  const { breakdown } = matchScore;
  const { seniority, location, salary, contractType } = breakdown;
  const euros = (amount: number) => new Intl.NumberFormat(language, { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(amount);
  const salaryRange = ({ min, max }: SalaryRange) => {
    if (min !== undefined && max !== undefined && min !== max) return t("extension.analysis.salary.range", { min: euros(min), max: euros(max) });
    if (min !== undefined && max !== undefined) return t("extension.analysis.salary.exactly", { amount: euros(min) });
    if (min !== undefined) return t("extension.analysis.salary.from", { amount: euros(min) });
    return t("extension.analysis.salary.upTo", { amount: euros(max!) });
  };

  /** What the Search Criteria want, any one of which is enough (ADR-0025): "Vous cherchez : Lyon ou Bordeaux". */
  const wanted = (values: string[]) =>
    values.length > 0 ? [t("extension.analysis.wanted", { value: new Intl.ListFormat(language, { type: "disjunction" }).format(values) })] : [];
  const contract = (value: string) => t(`cvReview.contractTypes.${value as "cdi"}`);

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
    location: [...(location.offer ? [location.offer] : []), ...wanted(wantedValues(location))],
    salary: [
      ...(salary.offer ? [t("extension.analysis.offer", { value: salaryRange(salary.offer) })] : []),
      ...(salary.wanted !== undefined ? [t("extension.analysis.salary.wanted", { amount: euros(salary.wanted) })] : []),
    ],
    contractType: [
      ...(contractType.offer ? [t("extension.analysis.offer", { value: contract(contractType.offer) })] : []),
      ...wanted(wantedValues(contractType).map(contract)),
    ],
  };
  const reliability = matchScoreReliability(matchScore);
  const known = CRITERIA.filter((name) => breakdown[name].status !== "unknown").length;
  const notes = [
    ...(reliability === "not_computable" ? [t("extension.analysis.notComputableNote")] : []),
    ...(reliability === "partial" ? [t("extension.analysis.partialNote", { count: known })] : []),
    ...(matchScore.offerTextUnread ? [t("extension.analysis.offerTextUnread")] : []),
  ];
  const label = (name: Criterion) => t(`extension.analysis.criteria.${name}`);
  // Named mid-sentence: « Points forts : IFRS, expérience et lieu. »
  const named = (name: Criterion) => label(name).toLocaleLowerCase(language);
  const and = (items: string[]) => new Intl.ListFormat(language, { type: "conjunction" }).format(items);
  const others = CRITERIA.filter((name) => name !== "skills");
  const strengths = [...breakdown.skills.covered, ...others.filter((name) => breakdown[name].status === "match").map(named)];
  const gaps = [...breakdown.skills.missing, ...others.filter((name) => breakdown[name].status === "mismatch").map(named)];
  return {
    score:
      reliability === "not_computable"
        ? t("extension.analysis.scoreNotComputable")
        : t(reliability === "partial" ? "extension.analysis.scorePartial" : "extension.analysis.score", { score: matchScore.score }),
    ...(reliability === "not_computable" ? {} : { ring: matchScore.score }),
    notes,
    criteria: CRITERIA.map((name) => {
      const status: CriterionStatus = breakdown[name].status;
      const key = status === "unknown" ? UNKNOWN_STATUS[missingSide(name, breakdown)] : status;
      const points = criterionPoints(breakdown, name);
      return {
        label: label(name),
        points: points ? t("extension.analysis.points", points) : t("extension.analysis.notSpecified"),
        ...(points ? { fill: Math.round((points.earned / points.possible) * 100) } : {}),
        status: t(`extension.analysis.status.${key}`),
        details: details[name],
      };
    }),
    strengthsAndGaps: [
      ...(strengths.length ? [t("extension.analysis.strengths", { items: and(strengths) })] : []),
      ...(gaps.length ? [t("extension.analysis.gaps", { items: and(gaps) })] : []),
    ],
  };
}

/**
 * What a rescore came to, so the Candidate sees it happened even when the value is the same (#76):
 * when it was computed, and whether the score changed from the one shown before, if any.
 */
export function describeRescore({ previous, current, at }: { previous?: MatchScore; current: MatchScore; at: Date }, { t, language }: I18n): string {
  const time = new Intl.DateTimeFormat(language, { timeStyle: "short" }).format(at);
  if (!previous) return t("extension.analysis.rescored", { time });
  const [before, now] = [scoreValue(previous, t), scoreValue(current, t)];
  if (before === now) return t("extension.analysis.rescoredUnchanged", { time });
  return t("extension.analysis.rescoredFrom", { time, score: before });
}
