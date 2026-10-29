import Link from "next/link";
import { Table, type Column } from "@/design/Table";
import type { EvalRun } from "@/evals";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";

type T = Awaited<ReturnType<typeof getServerT>>;

/** How an Eval Run's score, cost and mean response time read (#231). */
export function evalRunFormat(t: T, locale: string) {
  const eur = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", minimumFractionDigits: 4, maximumFractionDigits: 4 });
  const seconds = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const at = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" });
  const score = (value: number | null) => (value === null ? t("admin.evals.runs.noScore") : t("admin.evals.runs.scoreValue", { score: seconds.format(value) }));
  const time = (ms: number | null) => (ms === null ? "–" : t("admin.evals.runs.seconds", { seconds: seconds.format(ms / 1000) }));
  return {
    at: (date: Date) => at.format(date),
    score,
    cost: (value: number) => eur.format(value),
    time,
    summary: (run: EvalRun) => t("admin.evals.validation.summary", { score: score(run.score), cost: eur.format(run.costEur), time: time(run.responseMs), date: at.format(run.startedAt) }),
  };
}

/** A Playbook Agent as an Eval Run played it. */
export function agentText(t: T, agent: { provider: string; model: string | null; effort: "low" | "medium" | "high" | null }): string {
  return t("admin.coachingPlaybooks.agentSummary", {
    provider: agent.provider,
    model: agent.model ?? t("admin.coachingPlaybooks.providerDefault"),
    effort: agent.effort ? t(`admin.coachingPlaybooks.efforts.${agent.effort}`) : t("admin.coachingPlaybooks.effortDefault"),
  });
}

/** Eval Runs, newest first: when, on what (a Playbook Version's, with its Playbook Agent), score, cost, response time and who started it. */
export async function EvalRunsTable({ runs, caption }: { runs: EvalRun[]; caption: string }) {
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const format = evalRunFormat(t, locale);
  if (runs.length === 0) return <p>{t("admin.evals.runs.none")}</p>;
  const playbookRuns = runs.some((run) => run.subject.kind === "coaching_playbook");
  const columns: Column<EvalRun>[] = [
    { key: "startedAt", header: t("admin.evals.runs.startedAt"), rowHeader: true, cell: (run) => <time dateTime={run.startedAt.toISOString()}>{format.at(run.startedAt)}</time> },
    ...(playbookRuns
      ? [
          { key: "version", header: t("admin.evals.runs.version"), cell: (run: EvalRun) => (run.subject.kind === "coaching_playbook" ? run.subject.version : null) },
          {
            key: "agent",
            header: t("admin.evals.runs.agent"),
            cell: (run: EvalRun) =>
              run.subject.kind === "coaching_playbook" ? `${agentText(t, run.subject.agent)} (${t(run.subject.asSaved ? "admin.evals.runs.asSaved" : "admin.evals.runs.tried")})` : null,
          },
        ]
      : []),
    { key: "score", header: t("admin.evals.runs.score"), numeric: true, cell: (run) => format.score(run.score) },
    { key: "cost", header: t("admin.evals.runs.cost"), numeric: true, cell: (run) => format.cost(run.costEur) },
    { key: "time", header: t("admin.evals.runs.responseTime"), numeric: true, cell: (run) => format.time(run.responseMs) },
    { key: "startedBy", header: t("admin.evals.runs.startedBy"), cell: (run) => run.startedBy },
    { key: "details", header: t("admin.evals.runs.details"), cell: (run) => <Link href={routes.adminEvalRun(run.id)}>{t("admin.evals.runs.open")}</Link> },
  ];
  return <Table label={caption} columns={columns} rows={runs} rowKey={(run) => run.id} />;
}
