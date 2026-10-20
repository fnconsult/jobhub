import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireBackOffice } from "@/admin/server";
import { getCoachingPlaybooks } from "@/coaching-playbooks/server";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { GUARDRAIL_IDS, type GuardrailId } from "@/guardrails";
import type { EvalRun, GuardrailCaseResult, JudgedCaseResult } from "@/evals";
import { getEvals } from "@/evals/server";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";
import { agentText, evalRunFormat } from "../run-views";

type Params = Promise<{ id: string }>;

export async function generateMetadata(): Promise<Metadata> {
  // Metadata renders apart from the page: without this, the 404 shown to
  // non-Administrators would still carry the back office's title.
  await requireBackOffice("evalRuns");
  const t = await getServerT();
  return { title: `${t("admin.evals.title")} · ${t("admin.title")}`, robots: { index: false } };
}

const isGuardrailResult = (result: EvalRun["results"][number]): result is GuardrailCaseResult => "verdict" in result;

/**
 * One Eval Run (ADR-0023, #231): what it played and on what, who started it and when, its score, cost and mean
 * response time, then each case as it was played, with the reply and its score (or its verdict for a Guardrail).
 * Read by those who read what it played: the Coaching Playbooks, or the Guardrails.
 */
export default async function EvalRunPage({ params }: { params: Params }) {
  const { access } = await requireBackOffice("evalRuns");
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const run = await getEvals().run(decodeURIComponent((await params).id));
  if (!run || !access.can(run.subject.kind === "guardrails" ? "guardrails" : "coachingPlaybooks", "read")) notFound();
  const format = evalRunFormat(t, locale);
  const { subject } = run;
  const playbookTitle = subject.kind === "coaching_playbook" ? ((await getCoachingPlaybooks().history(subject.playbookId))?.playbook.title ?? subject.playbookId) : "";
  const back =
    subject.kind === "coaching_playbook" ? `${routes.adminCoachingPlaybook(subject.playbookId)}#eval-runs` : subject.kind === "guardrails" ? `${routes.adminGuardrails}#eval-runs` : `${routes.adminCoachingPlaybooks}#ai-coach-evals`;
  const guardrailName = (id: GuardrailId) => t(`admin.guardrails.names.${id}`);

  const judgedCase = (result: JudgedCaseResult, index: number) => (
    <section key={index} className="stack" aria-labelledby={`case-${index}`}>
      <h3 id={`case-${index}`}>{result.case.title}</h3>
      <dl>
        <dt>{t("admin.evals.run.context")}</dt>
        <dd lang="fr">{result.case.context}</dd>
        <dt>{t("admin.evals.run.message")}</dt>
        <dd lang="fr">{result.case.message}</dd>
        {result.case.inView ? (
          <>
            <dt>{t("admin.evals.run.inView")}</dt>
            <dd lang="fr">
              {t(`admin.evals.cases.inViewKinds.${result.case.inView.kind}`)} : {result.case.inView.text}
            </dd>
          </>
        ) : null}
        <dt>{t("admin.evals.run.criteria")}</dt>
        <dd lang="fr">{result.case.criteria}</dd>
        {result.case.consults ? (
          <>
            <dt>{t("admin.evals.run.consults")}</dt>
            <dd>{result.case.consults}</dd>
          </>
        ) : null}
        <dt>{t("admin.evals.run.consulted")}</dt>
        <dd>{result.consulted.length > 0 ? result.consulted.join(", ") : t("admin.evals.run.noneConsulted")}</dd>
        <dt>{t("admin.evals.run.reply")}</dt>
        <dd lang="fr" className="eval-reply">
          {result.reply ?? t("admin.evals.run.noReply")}
        </dd>
        <dt>{t("admin.evals.run.caseScore")}</dt>
        <dd>{format.score(result.score === null ? null : Math.round(result.score * 100))}</dd>
        {result.reason ? (
          <>
            <dt>{t("admin.evals.run.reason")}</dt>
            <dd lang="fr">{result.reason}</dd>
          </>
        ) : null}
        <dt>{t("admin.evals.run.caseCost")}</dt>
        <dd>{format.cost(result.costEur)}</dd>
        <dt>{t("admin.evals.run.caseTime")}</dt>
        <dd>{format.time(result.responseMs)}</dd>
      </dl>
    </section>
  );

  return (
    <BackOfficeLayout access={access}>
      <p>
        <Link href={back}>{t("admin.evals.back")}</Link>
      </p>
      <h1>{t("admin.evals.title")}</h1>
      <p className="lead">
        {subject.kind === "coaching_playbook"
          ? t("admin.evals.run.subjects.coaching_playbook", { playbook: playbookTitle, version: String(subject.version) })
          : t(`admin.evals.run.subjects.${subject.kind}`)}
      </p>
      <dl>
        <dt>{t("admin.evals.runs.startedBy")}</dt>
        <dd>{t("admin.evals.run.startedBy", { author: run.startedBy, date: format.at(run.startedAt) })}</dd>
        {subject.kind === "coaching_playbook" ? (
          <>
            <dt>{t("admin.evals.run.agent")}</dt>
            <dd>
              {agentText(t, subject.agent)} ({t(subject.asSaved ? "admin.evals.runs.asSaved" : "admin.evals.runs.tried")})
            </dd>
          </>
        ) : null}
        {subject.kind === "guardrails" ? (
          <>
            <dt>{t("admin.evals.run.settings")}</dt>
            <dd>{GUARDRAIL_IDS.map((id) => `${guardrailName(id)} : ${t(`admin.guardrails.settings.${subject.settings[id]}`)}`).join(" ; ")}</dd>
          </>
        ) : null}
        <dt>{t("admin.evals.run.judge")}</dt>
        <dd>{run.judge ? `${run.judge.provider} · ${run.judge.model}` : t("admin.evals.run.noJudge")}</dd>
        <dt>{t("admin.evals.runs.score")}</dt>
        <dd>{format.score(run.score)}</dd>
        <dt>{t("admin.evals.runs.cost")}</dt>
        <dd>{format.cost(run.costEur)}</dd>
        <dt>{t("admin.evals.runs.responseTime")}</dt>
        <dd>{format.time(run.responseMs)}</dd>
      </dl>

      <h2>{t("admin.evals.run.cases")}</h2>
      {run.results.map((result, index) =>
        isGuardrailResult(result) ? (
          <section key={index} className="stack" aria-labelledby={`case-${index}`}>
            <h3 id={`case-${index}`}>{result.case.title}</h3>
            <dl>
              <dt>{t("admin.evals.run.guardrail")}</dt>
              <dd>{guardrailName(result.case.guardrail)}</dd>
              <dt>{t("admin.evals.run.message")}</dt>
              <dd lang="fr">{result.case.message}</dd>
              {result.case.reply ? (
                <>
                  <dt>{t("admin.evals.run.reply")}</dt>
                  <dd lang="fr">{result.case.reply}</dd>
                </>
              ) : null}
              <dt>{t("admin.evals.run.expected")}</dt>
              <dd>{t(`admin.evals.run.verdicts.${result.expected}`)}</dd>
              <dt>{t("admin.evals.run.verdict")}</dt>
              <dd>
                {t(`admin.evals.run.verdicts.${result.verdict}`)} ({t(result.passed ? "admin.evals.run.passed" : "admin.evals.run.failed")})
              </dd>
              <dt>{t("admin.evals.run.caseCost")}</dt>
              <dd>{format.cost(result.costEur)}</dd>
            </dl>
          </section>
        ) : (
          judgedCase(result, index)
        ),
      )}
    </BackOfficeLayout>
  );
}
