import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { IntroPage } from "@/admin/page-intro";
import { playbookVersionFromForm } from "@/admin/playbook-form";
import { getCoachingPlaybooksBackOffice, requireBackOffice } from "@/admin/server";
import { getAi } from "@/ai/server";
import type { CoachingPlaybook, PlaybookKind, PlaybookVersion } from "@/coaching-playbooks";
import { getCoachingPlaybooks } from "@/coaching-playbooks/server";
import { playbookServing } from "@/coaching-playbooks/serving";
import { BackOfficeForm } from "@/components/BackOfficeForm";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { PageIntro } from "@/components/PageIntro";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { Field, TextInput } from "@/design/Field";
import { Note } from "@/design/Note";
import { Pill } from "@/design/Pill";
import { Table } from "@/design/Table";
import { getEvals } from "@/evals/server";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";
import { isNotice, NOTICES, noticeQuery } from "./notices";
import { EvalRunsTable } from "../evaluations/run-views";
import { PlaybookVersionFields } from "./version-fields";
import "../section.css";

/** This section's one-line intro (#466). */
const INTRO: IntroPage = "coachingPlaybooks";

export async function generateMetadata(): Promise<Metadata> {
  // Metadata renders apart from the page: without this, the 404 shown to
  // non-Administrators would still carry the back office's title.
  await requireBackOffice("coachingPlaybooks");
  const t = await getServerT();
  return { title: `${t("admin.coachingPlaybooks.title")} · ${t("admin.title")}`, robots: { index: false } };
}

/** The create form's field ids start with this; it creates a Coaching Playbook. */
const CREATE_FORM = "new-playbook";
const PLAYBOOK: PlaybookKind = "playbook";

async function createPlaybook(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("coachingPlaybooks", "write");
  const created = await getCoachingPlaybooksBackOffice().create(administrator, playbookVersionFromForm(form));
  if (created.ok) redirect(`${routes.adminCoachingPlaybook(created.version.playbookId)}${noticeQuery("created", 1)}`);
  redirect(`${routes.adminCoachingPlaybooks}${noticeQuery(created)}`);
}

/** Plays the AI Coach's own Eval Cases on the AI Coach as released (ADR-0023, #231): Playbook editors and super-admins only. */
async function evaluateAiCoach() {
  "use server";
  const { administrator } = await requireBackOffice("evalRuns", "write");
  const run = await getEvals().runAiCoach(administrator);
  redirect(routes.adminEvalRun(run.id));
}

/**
 * Playbook editors write the AI Coach's coaching knowledge (#225): the Core Digest, the Sources list and
 * the Coaching Playbooks, each with its Playbook Agent; and, apart, the task Playbooks (ADR-0026), each
 * AI task's instructions and the AI running it. Support reads them.
 */
export default async function CoachingPlaybooksPage({ searchParams }: { searchParams: Promise<{ notice?: string; detail?: string }> }) {
  const { access, canWrite } = await requireBackOffice("coachingPlaybooks");
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const { notice, detail } = await searchParams;
  const shown = isNotice(notice) ? notice : null;
  const [playbooks, aiCoachRuns] = await Promise.all([getCoachingPlaybooks().list(), getEvals().runs({ kind: "ai_coach" }, 10)]);
  const canRun = access.can("evalRuns", "write");
  const models = getAi().agentModels();
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "Europe/Paris" });

  const name = (playbook: CoachingPlaybook) =>
    playbook.kind === "playbook" || playbook.kind === "task" ? playbook.title : t(`admin.coachingPlaybooks.kinds.${playbook.kind}`);
  const versionLine = (version: PlaybookVersion) =>
    `${t("admin.coachingPlaybooks.version", { version: String(version.version) })}, ${
      version.validation ? t("admin.coachingPlaybooks.validatedBy", { name: version.validation.name, date: date.format(version.validation.at) }) : t("admin.coachingPlaybooks.notValidated")
    }`;
  // The AI Coach's knowledge, then the AI tasks' instructions apart: the AI Coach never consults these.
  const coaching = playbooks.filter((playbook) => playbook.kind !== "task");
  const tasks = playbooks.filter((playbook) => playbook.kind === "task");

  /** One row per playbook: its name, latest and served versions, who runs it, and whether it is archived. */
  const playbooksTable = (caption: string, agentHeading: string, rows: CoachingPlaybook[]) => (
    <Table
      label={caption}
      columns={[
        {
          header: t("admin.coachingPlaybooks.name"),
          rowHeader: true,
          cell: (playbook) => (
            <>
              <Link href={routes.adminCoachingPlaybook(playbook.id)}>{name(playbook)}</Link> <code>{playbook.id}</code>
            </>
          ),
        },
        { header: t("admin.coachingPlaybooks.latest"), cell: (playbook) => versionLine(playbook.latest) },
        {
          header: t("admin.coachingPlaybooks.served"),
          cell: (playbook) => (playbook.served ? t("admin.coachingPlaybooks.version", { version: String(playbook.served.version) }) : t("admin.coachingPlaybooks.none")),
        },
        {
          header: agentHeading,
          cell: (playbook) => {
            const agent = playbook.latest.agent;
            return (
              <>
                {agent
                  ? t("admin.coachingPlaybooks.agentSummary", {
                      provider: agent.provider,
                      model: agent.model ?? t("admin.coachingPlaybooks.providerDefault"),
                      effort: agent.effort ? t(`admin.coachingPlaybooks.efforts.${agent.effort}`) : t("admin.coachingPlaybooks.effortDefault"),
                    })
                  : playbook.kind === "task"
                    ? t("admin.coachingPlaybooks.tasks.webSearch")
                    : null}
                {playbook.latest.search
                  ? ` · ${t("admin.coachingPlaybooks.tasks.searchSummary", { provider: playbook.latest.search.provider, model: playbook.latest.search.model ?? t("admin.coachingPlaybooks.providerDefault") })}`
                  : null}
              </>
            );
          },
        },
        {
          header: t("admin.coachingPlaybooks.status"),
          cell: (playbook) => <Pill tone={playbook.archived ? "neutral" : "success"}>{t(playbook.archived ? "admin.coachingPlaybooks.archived" : "admin.coachingPlaybooks.active")}</Pill>,
        },
      ]}
      rows={rows}
      rowKey={(playbook) => playbook.id}
    />
  );

  return (
    <BackOfficeLayout access={access} title={t("admin.coachingPlaybooks.title")}>
      <div className="section-page">
        <PageIntro t={t} page={INTRO} subject={t("admin.coachingPlaybooks.title")}>
          <p>{t(playbookServing(process.env) === "validated" ? "admin.coachingPlaybooks.servingValidated" : "admin.coachingPlaybooks.servingLatest")}</p>
          {canWrite ? null : <p>{t("admin.readOnly")}</p>}
        </PageIntro>
        {shown ? (
          <Note tone={NOTICES[shown] ? "danger" : "success"} role={NOTICES[shown] ? "alert" : "status"}>
            {t(`admin.coachingPlaybooks.notices.${shown}`, { sources: detail ?? "", list: detail ?? "", version: "" })}
          </Note>
        ) : null}

        {playbooksTable(t("admin.coachingPlaybooks.caption"), t("admin.coachingPlaybooks.agent"), coaching)}

        <section className="section-block" aria-labelledby="tasks-title">
          <h2 id="tasks-title">{t("admin.coachingPlaybooks.tasks.title")}</h2>
          <p>{t("admin.coachingPlaybooks.tasks.intro")}</p>
          {playbooksTable(t("admin.coachingPlaybooks.tasks.caption"), t("admin.coachingPlaybooks.tasks.runBy"), tasks)}
        </section>

        <section className="section-block" aria-labelledby="models-title">
          <h2 id="models-title">{t("admin.coachingPlaybooks.models.title")}</h2>
          <p>{t("admin.coachingPlaybooks.fields.modelHelp")}</p>
          <Table
            label={t("admin.coachingPlaybooks.models.title")}
            columns={[
              { header: t("admin.coachingPlaybooks.models.provider"), rowHeader: true, cell: ({ choice }) => `${choice.provider} (${choice.endpoint})` },
              { header: t("admin.coachingPlaybooks.models.model"), cell: ({ each }) => each.model },
              { header: t("admin.coachingPlaybooks.models.residency"), cell: ({ each }) => t(each.residency === "eu" ? "admin.coachingPlaybooks.models.inEu" : "admin.coachingPlaybooks.outsideEu") },
              {
                header: t("admin.coachingPlaybooks.models.effort"),
                cell: ({ each }) => (each.effort === "native" ? t("admin.coachingPlaybooks.models.native") : t(`admin.coachingPlaybooks.effortHandling.${each.effort}`)),
              },
            ]}
            rows={models.flatMap((choice) => choice.models.map((each) => ({ choice, each })))}
            rowKey={({ choice, each }) => `${choice.provider} ${each.model}`}
          />
        </section>

        <section className="section-block" id="ai-coach-evals" aria-labelledby="ai-coach-evals-title">
          <h2 id="ai-coach-evals-title">{t("admin.evals.aiCoach.title")}</h2>
          <p>{t("admin.evals.aiCoach.intro")}</p>
          <BackOfficeForm canWrite={canRun} className="section-actions" action={evaluateAiCoach}>
            <button className={buttonClass()} type="submit" disabled={!canRun}>
              {t("admin.evals.aiCoach.start")}
            </button>
            <span className="section-meta">{t("admin.evals.runs.running")}</span>
          </BackOfficeForm>
          <EvalRunsTable runs={aiCoachRuns} caption={t("admin.evals.runs.caption")} />
        </section>

        <BackOfficeForm canWrite={canWrite} action={createPlaybook}>
          <Card title={t("admin.coachingPlaybooks.create.title")}>
            <fieldset className="section-form" disabled={!canWrite}>
              <Field label={t("admin.coachingPlaybooks.fields.id")} hint={t("admin.coachingPlaybooks.fields.idHelp")}>
                <TextInput name="id" required pattern="[a-z0-9]+(-[a-z0-9]+)*" autoComplete="off" />
              </Field>
              <PlaybookVersionFields idPrefix={CREATE_FORM} kind={PLAYBOOK} models={models} />
              <button className={buttonClass({ variant: "primary" })} type="submit">
                {t("admin.coachingPlaybooks.create.submit")}
              </button>
            </fieldset>
          </Card>
        </BackOfficeForm>
      </div>
    </BackOfficeLayout>
  );
}
