import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { EFFORTS } from "@jobhub/ai";
import { taskPlaybookSeed } from "@jobhub/coach-knowledge/tasks";
import { agentModelValue, effortOf, evalCaseFromForm, evalRunFromForm, playbookVersionFromForm } from "@/admin/playbook-form";
import { getCoachingPlaybooksBackOffice, getEvalCasesBackOffice, requireBackOffice } from "@/admin/server";
import { getAi } from "@/ai/server";
import { getCurrentCandidate } from "@/auth/server";
import { IMPORT_AUTHOR, type PlaybookVersion } from "@/coaching-playbooks";
import { getCoachingPlaybooks } from "@/coaching-playbooks/server";
import { BackOfficeForm } from "@/components/BackOfficeForm";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { EVAL_IN_VIEW_KINDS, type EvalRun, type PlaybookEvalCase } from "@/evals";
import { getEvals } from "@/evals/server";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";
import { isNotice, NOTICES, noticeQuery } from "../notices";
import { EvalRunsTable, evalRunFormat } from "../../evaluations/run-views";
import { PlaybookVersionFields } from "../version-fields";

type Params = Promise<{ id: string }>;

/** `aria-current` of the link to the version shown. */
const CURRENT = "page";
/** The edit form's field ids start with this. */
const EDIT_FORM = "edit-playbook";
/** The new Eval Case form's field ids start with this. */
const NEW_CASE_FORM = "new-case";

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  // Metadata renders apart from the page: without this, the 404 shown to
  // non-Administrators would still carry the back office's title.
  await requireBackOffice("coachingPlaybooks");
  const t = await getServerT();
  const { id } = await params;
  return { title: `${decodeURIComponent(id)} · ${t("admin.coachingPlaybooks.title")} · ${t("admin.title")}`, robots: { index: false } };
}

const back = (id: string, query: string): never => redirect(`${routes.adminCoachingPlaybook(id)}${query}`);

async function savePlaybook(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("coachingPlaybooks", "write");
  const id = String(form.get("playbookId"));
  const saved = await getCoachingPlaybooksBackOffice().save(administrator, id, playbookVersionFromForm(form));
  back(id, saved.ok ? noticeQuery("saved", saved.version.version) : noticeQuery(saved));
}

async function validatePlaybook(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("coachingPlaybooks", "write");
  const id = String(form.get("playbookId"));
  const version = Number(form.get("version"));
  const name = String(form.get("name") ?? "").trim();
  if (!name) back(id, noticeQuery("nameRequired", version));
  const validated = await getCoachingPlaybooksBackOffice().validate({ ...administrator, name }, id, version);
  back(id, validated.ok ? noticeQuery("validated", version) : noticeQuery(validated, version));
}

const backTo = (id: string, query: string, anchor: string): never => redirect(`${routes.adminCoachingPlaybook(id)}${query}#${anchor}`);

async function addEvalCase(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("coachingPlaybooks", "write");
  const id = String(form.get("playbookId"));
  const added = await getEvalCasesBackOffice().addCase(administrator, id, evalCaseFromForm(form));
  backTo(id, noticeQuery(added.ok ? "caseAdded" : added), "eval-cases");
}

async function saveEvalCase(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("coachingPlaybooks", "write");
  const id = String(form.get("playbookId"));
  const saved = await getEvalCasesBackOffice().saveCase(administrator, id, String(form.get("caseId")), evalCaseFromForm(form));
  backTo(id, noticeQuery(saved.ok ? "caseSaved" : saved), "eval-cases");
}

async function removeEvalCase(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("coachingPlaybooks", "write");
  const id = String(form.get("playbookId"));
  const removed = await getEvalCasesBackOffice().removeCase(administrator, id, String(form.get("caseId")));
  backTo(id, noticeQuery(removed.ok ? "caseRemoved" : removed), "eval-cases");
}

/** Only Playbook editors and super-admins start an Eval Run (ADR-0023): its AI calls cost. */
async function startEvalRun(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("evalRuns", "write");
  const id = String(form.get("playbookId"));
  const done = await getEvals().runPlaybook(administrator, id, evalRunFromForm(form));
  if (done.ok) redirect(routes.adminEvalRun(done.run.id));
  backTo(id, noticeQuery(done), "eval-runs");
}

async function archivePlaybook(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("coachingPlaybooks", "write");
  const id = String(form.get("playbookId"));
  const archived = form.get("archived") === "true";
  const done = await getCoachingPlaybooksBackOffice().setArchived(administrator, id, archived);
  back(id, done.ok ? noticeQuery(archived ? "archived" : "restored") : noticeQuery(done));
}

/** One Coaching Playbook, the Core Digest, the Sources list or a task Playbook (#225, ADR-0026): its versions, one of them in full, and what a Playbook editor can do. */
export default async function CoachingPlaybookPage({ params, searchParams }: { params: Params; searchParams: Promise<{ version?: string; notice?: string; detail?: string }> }) {
  const { access, canWrite } = await requireBackOffice("coachingPlaybooks");
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const { id } = await params;
  const { version: requested, notice, detail } = await searchParams;
  const history = await getCoachingPlaybooks().history(decodeURIComponent(id));
  if (!history) notFound();
  const { playbook, versions } = history;
  const searchModels = getAi().searchModels();
  const shown = isNotice(notice) ? notice : null;
  const selected: PlaybookVersion | undefined = requested ? versions.find((version) => String(version.version) === requested) : playbook.latest;
  const at = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" });
  const title = playbook.kind === "playbook" || playbook.kind === "task" ? playbook.title : t(`admin.coachingPlaybooks.kinds.${playbook.kind}`);
  // A task Playbook as the code knows it: the sections and slots its text must hold, and whether a Playbook Agent runs it.
  const task = playbook.kind === "task" ? taskPlaybookSeed(playbook.id) : undefined;
  // The models its Playbook Agent may run on: the EU ones alone for a task that runs only in the EU (ADR-0052).
  const models = getAi().agentModels(task?.aiTask);
  const versionName = (version: number) => t("admin.coachingPlaybooks.detail.versionLink", { version: String(version) });
  const accountName = (await getCurrentCandidate())?.name?.trim() ?? "";
  const latest = playbook.latest;
  const isPlaybook = playbook.kind === "playbook";
  const evals = getEvals();
  const [evalCases, runs, runOnLatest, runOnServed] = isPlaybook
    ? await Promise.all([evals.cases(playbook.id), evals.runs({ playbookId: playbook.id }), evals.playedOn(latest), playbook.served ? evals.playedOn(playbook.served) : null])
    : [[], [], null, null];
  const canRun = access.can("evalRuns", "write");
  const runFormat = evalRunFormat(t, locale);
  const runLine = (run: EvalRun | null, none: string) =>
    run ? (
      <>
        {runFormat.summary(run)} (<Link href={routes.adminEvalRun(run.id)}>{t("admin.evals.runs.open")}</Link>)
      </>
    ) : (
      none
    );
  const caseFields = (prefix: string, evalCase?: PlaybookEvalCase) => (
    <>
      <div className="stack">
        <label htmlFor={`${prefix}-title`}>{t("admin.evals.cases.fields.title")}</label>
        <input id={`${prefix}-title`} className="input" name="title" required maxLength={120} lang="fr" defaultValue={evalCase?.title} />
      </div>
      <div className="stack">
        <label htmlFor={`${prefix}-context`}>{t("admin.evals.cases.fields.context")}</label>
        <textarea id={`${prefix}-context`} className="input" name="context" rows={3} required lang="fr" defaultValue={evalCase?.context} aria-describedby={`${prefix}-context-help`} />
        <p id={`${prefix}-context-help`}>{t("admin.evals.cases.fields.contextHelp")}</p>
      </div>
      <div className="stack">
        <label htmlFor={`${prefix}-message`}>{t("admin.evals.cases.fields.message")}</label>
        <textarea id={`${prefix}-message`} className="input" name="message" rows={3} required lang="fr" defaultValue={evalCase?.message} />
      </div>
      <div className="stack">
        <label htmlFor={`${prefix}-in-view-kind`}>{t("admin.evals.cases.fields.inViewKind")}</label>
        <select id={`${prefix}-in-view-kind`} className="input" name="inViewKind" defaultValue={evalCase?.inView?.kind ?? ""}>
          <option value="">{t("admin.evals.cases.fields.inViewNone")}</option>
          {EVAL_IN_VIEW_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {t(`admin.evals.cases.inViewKinds.${kind}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="stack">
        <label htmlFor={`${prefix}-in-view-text`}>{t("admin.evals.cases.fields.inViewText")}</label>
        <textarea id={`${prefix}-in-view-text`} className="input" name="inViewText" rows={4} lang="fr" defaultValue={evalCase?.inView?.text} aria-describedby={`${prefix}-in-view-text-help`} />
        <p id={`${prefix}-in-view-text-help`}>{t("admin.evals.cases.fields.inViewTextHelp")}</p>
      </div>
      <div className="stack">
        <label htmlFor={`${prefix}-criteria`}>{t("admin.evals.cases.fields.criteria")}</label>
        <textarea id={`${prefix}-criteria`} className="input" name="criteria" rows={3} required lang="fr" defaultValue={evalCase?.criteria} aria-describedby={`${prefix}-criteria-help`} />
        <p id={`${prefix}-criteria-help`}>{t("admin.evals.cases.fields.criteriaHelp")}</p>
      </div>
    </>
  );

  return (
    <BackOfficeLayout access={access} title={title}>
      <p>
        <Link href={routes.adminCoachingPlaybooks}>{t("admin.coachingPlaybooks.detail.back")}</Link>
      </p>
      <p className="lead">
        <code>{playbook.id}</code> · {t(playbook.archived ? "admin.coachingPlaybooks.archived" : "admin.coachingPlaybooks.active")} · {t("admin.coachingPlaybooks.served")} :{" "}
        {playbook.served ? t("admin.coachingPlaybooks.version", { version: String(playbook.served.version) }) : t("admin.coachingPlaybooks.none")}
      </p>
      {canWrite ? null : <p className="notice">{t("admin.readOnly")}</p>}
      {shown ? (
        <p className="notice" role={NOTICES[shown] ? "alert" : "status"}>
          {t(`admin.coachingPlaybooks.notices.${shown}`, { version: requested ?? "", sources: detail ?? "", list: detail ?? "" })}
        </p>
      ) : null}

      <nav aria-labelledby="versions-title">
        <h2 id="versions-title">{t("admin.coachingPlaybooks.detail.versions")}</h2>
        <ul>
          {versions.map((version) => {
            const tags = [
              version.version === latest.version ? t("admin.coachingPlaybooks.detail.latestTag") : null,
              version.version === playbook.served?.version ? t("admin.coachingPlaybooks.detail.servedTag") : null,
              version.validation
                ? t("admin.coachingPlaybooks.validatedBy", { name: version.validation.name, date: at.format(version.validation.at) })
                : t("admin.coachingPlaybooks.notValidated"),
            ].filter(Boolean);
            return (
              <li key={version.version}>
                <Link href={routes.adminCoachingPlaybook(playbook.id, version.version)} aria-current={version.version === selected?.version ? CURRENT : undefined}>
                  {versionName(version.version)}
                </Link>{" "}
                ({tags.join(", ")})
              </li>
            );
          })}
        </ul>
      </nav>

      {selected ? (
        <section className="stack" aria-labelledby="version-title">
          <h2 id="version-title">{t("admin.coachingPlaybooks.detail.versionTitle", { version: String(selected.version) })}</h2>
          <dl>
            <dt>{t("admin.coachingPlaybooks.detail.authors")}</dt>
            <dd>{selected.authors.map((author) => (author === IMPORT_AUTHOR ? t("admin.coachingPlaybooks.detail.importAuthor") : author)).join(", ")}</dd>
            <dt>{t("admin.coachingPlaybooks.detail.createdAt")}</dt>
            <dd>{at.format(selected.createdAt)}</dd>
            <dt>{t("admin.coachingPlaybooks.detail.updatedAt")}</dt>
            <dd>{at.format(selected.updatedAt)}</dd>
            <dt>{t("admin.coachingPlaybooks.detail.validation")}</dt>
            <dd>
              {selected.validation
                ? t("admin.coachingPlaybooks.validatedBy", { name: `${selected.validation.name} (${selected.validation.email})`, date: at.format(selected.validation.at) })
                : t("admin.coachingPlaybooks.notValidated")}
            </dd>
            {selected.agent ? (
              <>
                <dt>{t("admin.coachingPlaybooks.agent")}</dt>
                <dd>
                  {t("admin.coachingPlaybooks.agentSummary", {
                    provider: selected.agent.provider,
                    model: selected.agent.model ?? t("admin.coachingPlaybooks.providerDefault"),
                    effort: selected.agent.effort ? t(`admin.coachingPlaybooks.efforts.${selected.agent.effort}`) : t("admin.coachingPlaybooks.effortDefault"),
                  })}
                  {effortOf(models, selected.agent.provider, selected.agent.model) === "native"
                    ? null
                    : ` (${t(`admin.coachingPlaybooks.effortHandling.${effortOf(models, selected.agent.provider, selected.agent.model)}`)})`}
                </dd>
                {playbook.kind === "task" ? null : (
                  <>
                    <dt>{t("admin.coachingPlaybooks.fields.consultWhen")}</dt>
                    <dd lang="fr">{selected.agent.consultWhen}</dd>
                  </>
                )}
              </>
            ) : playbook.kind === "task" ? (
              <>
                <dt>{t("admin.coachingPlaybooks.tasks.runBy")}</dt>
                <dd>{t("admin.coachingPlaybooks.detail.taskWebSearch")}</dd>
              </>
            ) : null}
            {task?.search ? (
              <>
                <dt>{t("admin.coachingPlaybooks.detail.search")}</dt>
                <dd>
                  {selected.search
                    ? `${selected.search.provider} · ${selected.search.model ?? t("admin.coachingPlaybooks.providerDefault")}`
                    : t("admin.coachingPlaybooks.fields.searchConfigured")}
                </dd>
              </>
            ) : null}
          </dl>
          <h3>{t(playbook.kind === "task" ? "admin.coachingPlaybooks.detail.instructions" : "admin.coachingPlaybooks.detail.rules")}</h3>
          <pre className="playbook-rules" lang="fr">
            {selected.content}
          </pre>
        </section>
      ) : (
        <p className="notice" role="alert">
          {t("admin.coachingPlaybooks.detail.noVersion")}
        </p>
      )}

      {latest.validation ? null : (
        <BackOfficeForm canWrite={canWrite} className="stack quota-form" action={validatePlaybook}>
          <fieldset disabled={!canWrite}>
            <legend>
              <h2>{t("admin.coachingPlaybooks.detail.validateTitle", { version: String(latest.version) })}</h2>
            </legend>
            <p>{t("admin.coachingPlaybooks.detail.validateHelp")}</p>
            {isPlaybook ? (
              <dl>
                <dt>{t("admin.evals.validation.onLatest", { version: String(latest.version) })}</dt>
                <dd>{runLine(runOnLatest, t("admin.evals.validation.noRunOnLatest"))}</dd>
                <dt>{playbook.served ? t("admin.evals.validation.onServed", { version: String(playbook.served.version) }) : t("admin.evals.validation.noneServed")}</dt>
                {playbook.served ? <dd>{runLine(runOnServed, t("admin.evals.validation.noRunOnServed"))}</dd> : null}
                <dd>{t("admin.evals.validation.noScoreBlocks")}</dd>
              </dl>
            ) : null}
            <input type="hidden" name="playbookId" value={playbook.id} />
            <input type="hidden" name="version" value={latest.version} />
            <div className="stack">
              <label htmlFor="validator-name">{t("admin.coachingPlaybooks.detail.validatorName")}</label>
              <input id="validator-name" className="input" name="name" required autoComplete="name" defaultValue={accountName} />
            </div>
            <button className="button button-primary" type="submit">
              {t("admin.coachingPlaybooks.detail.validate", { version: String(latest.version) })}
            </button>
          </fieldset>
        </BackOfficeForm>
      )}

      {isPlaybook ? (
        <section className="stack" id="eval-cases" aria-labelledby="eval-cases-title">
          <h2 id="eval-cases-title">{t("admin.evals.cases.title")}</h2>
          <p>{t("admin.evals.cases.intro")}</p>
          {evalCases.length === 0 ? <p>{t("admin.evals.cases.none")}</p> : null}
          {evalCases.map((evalCase) => (
            <article key={evalCase.id} className="stack" aria-labelledby={`case-${evalCase.id}-title`}>
              <h3 id={`case-${evalCase.id}-title`}>{evalCase.title}</h3>
              <p>{t("admin.evals.cases.writtenBy", { author: evalCase.author, date: at.format(evalCase.updatedAt) })}</p>
              <dl>
                <dt>{t("admin.evals.run.context")}</dt>
                <dd lang="fr">{evalCase.context}</dd>
                <dt>{t("admin.evals.run.message")}</dt>
                <dd lang="fr">{evalCase.message}</dd>
                {evalCase.inView ? (
                  <>
                    <dt>{t("admin.evals.run.inView")}</dt>
                    <dd lang="fr">
                      {t(`admin.evals.cases.inViewKinds.${evalCase.inView.kind}`)} : {evalCase.inView.text}
                    </dd>
                  </>
                ) : null}
                <dt>{t("admin.evals.run.criteria")}</dt>
                <dd lang="fr">{evalCase.criteria}</dd>
              </dl>
              {canWrite ? (
                <details>
                  <summary>{t("admin.evals.cases.edit")}</summary>
                  <BackOfficeForm canWrite={canWrite} className="stack quota-form" action={saveEvalCase}>
                    <input type="hidden" name="playbookId" value={playbook.id} />
                    <input type="hidden" name="caseId" value={evalCase.id} />
                    {caseFields(`edit-case-${evalCase.id}`, evalCase)}
                    <button className="button button-primary" type="submit">
                      {t("admin.evals.cases.save")}
                    </button>
                  </BackOfficeForm>
                  <BackOfficeForm canWrite={canWrite} className="stack" action={removeEvalCase}>
                    <input type="hidden" name="playbookId" value={playbook.id} />
                    <input type="hidden" name="caseId" value={evalCase.id} />
                    <button className="button" type="submit">
                      {t("admin.evals.cases.remove")}
                    </button>
                  </BackOfficeForm>
                </details>
              ) : null}
            </article>
          ))}
          <BackOfficeForm canWrite={canWrite} className="stack quota-form" action={addEvalCase}>
            <fieldset disabled={!canWrite}>
              <legend>
                <h3>{t("admin.evals.cases.add")}</h3>
              </legend>
              <input type="hidden" name="playbookId" value={playbook.id} />
              {caseFields(NEW_CASE_FORM)}
              <button className="button button-primary" type="submit">
                {t("admin.evals.cases.addButton")}
              </button>
            </fieldset>
          </BackOfficeForm>
        </section>
      ) : null}

      {isPlaybook ? (
        <section className="stack" id="eval-runs" aria-labelledby="eval-runs-title">
          <h2 id="eval-runs-title">{t("admin.evals.runs.title")}</h2>
          <p>{t("admin.evals.runs.intro")}</p>
          <BackOfficeForm canWrite={canRun} className="stack quota-form" action={startEvalRun}>
            <fieldset disabled={!canRun}>
              <legend>
                <h3>{t("admin.evals.runs.start", { version: String(latest.version) })}</h3>
              </legend>
              <p id="eval-run-help">{t("admin.evals.runs.startHelp")}</p>
              <input type="hidden" name="playbookId" value={playbook.id} />
              <div className="stack">
                <label htmlFor="eval-run-version">{t("admin.evals.runs.version")}</label>
                <select id="eval-run-version" className="input" name="version" defaultValue={String(latest.version)}>
                  {[latest, ...(playbook.served && playbook.served.version !== latest.version ? [playbook.served] : [])].map((version) => (
                    <option key={version.version} value={version.version}>
                      {versionName(version.version)}
                      {version.version === playbook.served?.version ? ` (${t("admin.coachingPlaybooks.detail.servedTag")})` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="stack">
                <label htmlFor="eval-run-model">{t("admin.evals.runs.model")}</label>
                <select id="eval-run-model" className="input" name="agentModel" defaultValue="" aria-describedby="eval-run-help">
                  <option value="">{t("admin.evals.runs.agentAsSaved")}</option>
                  {models.map((choice) => (
                    <optgroup key={choice.provider} label={`${choice.provider} (${choice.endpoint})`}>
                      <option value={agentModelValue(choice.provider, null)}>{`${choice.provider} · ${t("admin.coachingPlaybooks.defaultModel", { model: choice.defaultModel ?? "?" })}`}</option>
                      {choice.models.map((each) => (
                        <option key={each.model} value={agentModelValue(choice.provider, each.model)}>
                          {`${choice.provider} · ${each.model}`}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div className="stack">
                <label htmlFor="eval-run-effort">{t("admin.evals.runs.effort")}</label>
                <select id="eval-run-effort" className="input" name="effort" defaultValue="">
                  <option value="">{t("admin.evals.runs.agentAsSaved")}</option>
                  {EFFORTS.map((effort) => (
                    <option key={effort} value={effort}>
                      {t(`admin.coachingPlaybooks.efforts.${effort}`)}
                    </option>
                  ))}
                </select>
              </div>
              <p>{t("admin.evals.runs.running")}</p>
              <button className="button button-primary" type="submit" disabled={evalCases.length === 0}>
                {t("admin.evals.runs.startButton")}
              </button>
            </fieldset>
          </BackOfficeForm>
          <EvalRunsTable runs={runs} caption={t("admin.evals.runs.caption")} />
        </section>
      ) : null}

      <BackOfficeForm canWrite={canWrite} className="stack quota-form" action={savePlaybook}>
        <fieldset disabled={!canWrite}>
          <legend>
            <h2>{t("admin.coachingPlaybooks.detail.editTitle")}</h2>
          </legend>
          <p>
            {latest.validation
              ? t("admin.coachingPlaybooks.detail.editValidated", { version: String(latest.version), next: String(latest.version + 1) })
              : t("admin.coachingPlaybooks.detail.editDraft", { version: String(latest.version) })}
          </p>
          <input type="hidden" name="playbookId" value={playbook.id} />
          <PlaybookVersionFields idPrefix={EDIT_FORM} kind={playbook.kind} version={latest} models={models} searchModels={searchModels} task={task} />
          <button className="button button-primary" type="submit">
            {t("admin.coachingPlaybooks.detail.save")}
          </button>
        </fieldset>
      </BackOfficeForm>

      {playbook.kind === "playbook" || playbook.kind === "task" ? (
        <BackOfficeForm canWrite={canWrite} className="stack" action={archivePlaybook}>
          <h2>{t("admin.coachingPlaybooks.detail.archiveTitle")}</h2>
          <p>{t(playbook.kind === "task" ? "admin.coachingPlaybooks.detail.taskArchiveHelp" : "admin.coachingPlaybooks.detail.archiveHelp")}</p>
          <input type="hidden" name="playbookId" value={playbook.id} />
          <input type="hidden" name="archived" value={String(!playbook.archived)} />
          <button className="button" type="submit" disabled={!canWrite}>
            {t(playbook.archived ? "admin.coachingPlaybooks.detail.restore" : "admin.coachingPlaybooks.detail.archive")}
          </button>
        </BackOfficeForm>
      ) : null}
    </BackOfficeLayout>
  );
}
