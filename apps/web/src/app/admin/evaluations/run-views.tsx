import Link from "next/link";
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
  return (
    <div className="table-scroll">
      <table className="application-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{t("admin.evals.runs.startedAt")}</th>
            {playbookRuns ? (
              <>
                <th scope="col">{t("admin.evals.runs.version")}</th>
                <th scope="col">{t("admin.evals.runs.agent")}</th>
              </>
            ) : null}
            <th scope="col">{t("admin.evals.runs.score")}</th>
            <th scope="col">{t("admin.evals.runs.cost")}</th>
            <th scope="col">{t("admin.evals.runs.responseTime")}</th>
            <th scope="col">{t("admin.evals.runs.startedBy")}</th>
            <th scope="col">{t("admin.evals.runs.details")}</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <th scope="row">
                <time dateTime={run.startedAt.toISOString()}>{format.at(run.startedAt)}</time>
              </th>
              {playbookRuns ? (
                run.subject.kind === "coaching_playbook" ? (
                  <>
                    <td>{run.subject.version}</td>
                    <td>
                      {agentText(t, run.subject.agent)} ({t(run.subject.asSaved ? "admin.evals.runs.asSaved" : "admin.evals.runs.tried")})
                    </td>
                  </>
                ) : (
                  <>
                    <td />
                    <td />
                  </>
                )
              ) : null}
              <td>{format.score(run.score)}</td>
              <td>{format.cost(run.costEur)}</td>
              <td>{format.time(run.responseMs)}</td>
              <td>{run.startedBy}</td>
              <td>
                <Link href={routes.adminEvalRun(run.id)}>{t("admin.evals.runs.open")}</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
