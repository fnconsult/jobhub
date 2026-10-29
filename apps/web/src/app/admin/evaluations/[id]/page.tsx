import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireBackOffice } from "@/admin/server";
import { getCoachingPlaybooks } from "@/coaching-playbooks/server";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { Card } from "@/design/Card";
import { Properties, Property } from "@/design/Properties";
import { GUARDRAIL_IDS, type GuardrailId } from "@/guardrails";
import type { EvalRun, GuardrailCaseResult, JudgedCaseResult } from "@/evals";
import { getEvals } from "@/evals/server";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";
import { agentText, evalRunFormat } from "../run-views";
import "../../section.css";

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
    <CaseCard key={index} id={`case-${index}`} title={result.case.title}>
      <Property term={t("admin.evals.run.context")} lang="fr">
        {result.case.context}
      </Property>
      <Property term={t("admin.evals.run.message")} lang="fr">
        {result.case.message}
      </Property>
      {result.case.inView ? (
        <Property term={t("admin.evals.run.inView")} lang="fr">
          {t(`admin.evals.cases.inViewKinds.${result.case.inView.kind}`)} : {result.case.inView.text}
        </Property>
      ) : null}
      <Property term={t("admin.evals.run.criteria")} lang="fr">
        {result.case.criteria}
      </Property>
      {result.case.consults ? <Property term={t("admin.evals.run.consults")}>{result.case.consults}</Property> : null}
      <Property term={t("admin.evals.run.consulted")}>{result.consulted.length > 0 ? result.consulted.join(", ") : t("admin.evals.run.noneConsulted")}</Property>
      <Property term={t("admin.evals.run.reply")} lang="fr">
        <span className="section-text">{result.reply ?? t("admin.evals.run.noReply")}</span>
      </Property>
      <Property term={t("admin.evals.run.caseScore")}>{format.score(result.score === null ? null : Math.round(result.score * 100))}</Property>
      {result.reason ? (
        <Property term={t("admin.evals.run.reason")} lang="fr">
          {result.reason}
        </Property>
      ) : null}
      <Property term={t("admin.evals.run.caseCost")}>{format.cost(result.costEur)}</Property>
      <Property term={t("admin.evals.run.caseTime")}>{format.time(result.responseMs)}</Property>
    </CaseCard>
  );

  return (
    <BackOfficeLayout access={access} title={t("admin.evals.title")}>
      <div className="section-page">
        <p>
          <Link href={back}>{t("admin.evals.back")}</Link>
        </p>
        <p className="section-lead">
          {subject.kind === "coaching_playbook"
            ? t("admin.evals.run.subjects.coaching_playbook", { playbook: playbookTitle, version: String(subject.version) })
            : t(`admin.evals.run.subjects.${subject.kind}`)}
        </p>
        <Card>
          <Properties>
            <Property term={t("admin.evals.runs.startedBy")}>{t("admin.evals.run.startedBy", { author: run.startedBy, date: format.at(run.startedAt) })}</Property>
            {subject.kind === "coaching_playbook" ? (
              <Property term={t("admin.evals.run.agent")}>
                {agentText(t, subject.agent)} ({t(subject.asSaved ? "admin.evals.runs.asSaved" : "admin.evals.runs.tried")})
              </Property>
            ) : null}
            {subject.kind === "guardrails" ? (
              <Property term={t("admin.evals.run.settings")}>{GUARDRAIL_IDS.map((id) => `${guardrailName(id)} : ${t(`admin.guardrails.settings.${subject.settings[id]}`)}`).join(" ; ")}</Property>
            ) : null}
            <Property term={t("admin.evals.run.judge")}>{run.judge ? `${run.judge.provider} · ${run.judge.model}` : t("admin.evals.run.noJudge")}</Property>
            <Property term={t("admin.evals.runs.score")}>{format.score(run.score)}</Property>
            <Property term={t("admin.evals.runs.cost")}>{format.cost(run.costEur)}</Property>
            <Property term={t("admin.evals.runs.responseTime")}>{format.time(run.responseMs)}</Property>
          </Properties>
        </Card>

        <h2>{t("admin.evals.run.cases")}</h2>
        {run.results.map((result, index) =>
          isGuardrailResult(result) ? (
            <CaseCard key={index} id={`case-${index}`} title={result.case.title}>
              <Property term={t("admin.evals.run.guardrail")}>{guardrailName(result.case.guardrail)}</Property>
              <Property term={t(result.case.email ? "admin.evals.run.email" : "admin.evals.run.message")} lang="fr">
                {result.case.message}
              </Property>
              {result.case.email ? (
                <Property term={t("admin.evals.run.emailReading")} lang="fr">
                  {JSON.stringify(result.case.email.reading)}
                </Property>
              ) : null}
              {result.case.reply ? (
                <Property term={t("admin.evals.run.reply")} lang="fr">
                  {result.case.reply}
                </Property>
              ) : null}
              <Property term={t("admin.evals.run.expected")}>{t(`admin.evals.run.verdicts.${result.expected}`)}</Property>
              <Property term={t("admin.evals.run.verdict")}>
                {t(`admin.evals.run.verdicts.${result.verdict}`)} ({t(result.passed ? "admin.evals.run.passed" : "admin.evals.run.failed")})
              </Property>
              <Property term={t("admin.evals.run.caseCost")}>{format.cost(result.costEur)}</Property>
            </CaseCard>
          ) : (
            judgedCase(result, index)
          ),
        )}
      </div>
    </BackOfficeLayout>
  );
}

/** One case the run played: a region named by its title, on a card, its properties inside. */
function CaseCard({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <Card title={<span id={id}>{title}</span>} headingLevel={3}>
        <Properties>{children}</Properties>
      </Card>
    </section>
  );
}
