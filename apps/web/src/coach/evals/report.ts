/**
 * A Coach eval run as Markdown, to commit under docs/research/coach-evals/: each model's summary,
 * the recommended default, each case's scores (adherence / figures / tone) and the figures the
 * judge found outside the playbooks.
 */
import { EUR_PER_USD } from "@jobhub/ai";
import { COACH_MESSAGE_COST_TARGET_EUR } from "../../coach-conversations";
import type { CoachEvalCaseResult, CoachEvalReport } from "./index";
import { PASS_SCORE } from "./judge";

/** What identifies a run: when, on which commit, with which version of the eval set. */
export interface CoachEvalRun {
  date: string;
  commit: string;
  setVersion: string;
}

const eur = (value: number | null) => (value === null ? "–" : `€${value.toFixed(4)}`);
const row = (cells: string[]) => `| ${cells.join(" | ")} |`;
const score = (value: number | undefined) => (value === undefined ? "–" : value.toFixed(2));

function cell(result: CoachEvalCaseResult | undefined): string {
  if (!result) return "–";
  if (result.error === "coach") return "no reply";
  if (!result.judgment) return "not judged";
  const { adherence, figures, tone } = result.judgment;
  return `${adherence.score} / ${figures.score} / ${tone.score}${result.passed ? "" : " ✗"}`;
}

export function renderCoachEvalReport(report: CoachEvalReport, run: CoachEvalRun): string {
  const caseIds = [...new Set(report.models.flatMap((model) => model.results.map((result) => result.caseId)))];
  const figuresOutside = report.models.flatMap((model) =>
    model.results.flatMap((result) => (result.judgment?.figures.outside.length ? [`- ${model.model}, ${result.caseId}: ${result.judgment.figures.outside.join(" · ")}`] : [])),
  );
  return [
    `# Coach eval run, ${run.date}`,
    "",
    `Eval set \`${run.setVersion}\` (${caseIds.length} cases), commit \`${run.commit}\`. Judge: \`${report.judge.model}\`, which cost ${eur(report.judge.eur)} in all (not counted in the Coach's cost).`,
    `A case passes when the judge scores each criterion ${PASS_SCORE} or more out of 5. Costs are the Coach Message Cost: list prices at €${EUR_PER_USD} per $, against the Coach cost target of €${COACH_MESSAGE_COST_TARGET_EUR} per reply (median and p90).`,
    "",
    "## Models",
    "",
    "| Model | Passed | Adherence | Figures | Tone | Median € | p90 € | Within target |",
    "|---|---|---|---|---|---|---|---|",
    ...report.models.map(({ model, summary }) =>
      row([
        model,
        `${summary.passed} / ${summary.cases}`,
        score(summary.scores?.adherence),
        score(summary.scores?.figures),
        score(summary.scores?.tone),
        eur(summary.medianEur),
        eur(summary.p90Eur),
        summary.withinTarget ? "yes" : "no",
      ]),
    ),
    "",
    `**Recommended default: ${report.recommended.model ?? "none"}.** ${report.recommended.reason}`,
    "",
    "## Cases",
    "",
    "Adherence / figures / tone, out of 5; ✗: not passed.",
    "",
    row(["Case", ...report.models.map((model) => model.model)]),
    row(["---", ...report.models.map(() => "---")]).replaceAll(" ", ""),
    ...caseIds.map((caseId) => row([caseId, ...report.models.map((model) => cell(model.results.find((result) => result.caseId === caseId)))])),
    "",
    "## Figures outside the playbooks",
    "",
    ...(figuresOutside.length > 0 ? figuresOutside : ["None found."]),
    "",
  ].join("\n");
}
