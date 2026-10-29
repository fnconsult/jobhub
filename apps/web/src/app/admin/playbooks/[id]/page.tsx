import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { EFFORTS } from "@jobhub/ai";
import { taskPlaybookSeed } from "@jobhub/coach-knowledge/tasks";
import { agentModelValue, defaultModelLabel, effortOf, evalCaseFromForm, evalRunFromForm, playbookVersionFromForm } from "@/admin/playbook-form";
import { getCoachingPlaybooksBackOffice, getEvalCasesBackOffice, requireBackOffice } from "@/admin/server";
import { getAi } from "@/ai/server";
import { getCurrentCandidate } from "@/auth/server";
import { IMPORT_AUTHOR, type PlaybookVersion } from "@/coaching-playbooks";
import { getCoachingPlaybooks } from "@/coaching-playbooks/server";
import { BackOfficeForm } from "@/components/BackOfficeForm";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { Button } from "@/design/Button";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { Drawer } from "@/design/Drawer";
import { Field, Select, Textarea, TextInput } from "@/design/Field";
import { Note } from "@/design/Note";
import { Properties, Property } from "@/design/Properties";
import { EVAL_IN_VIEW_KINDS, type EvalRun, type PlaybookEvalCase } from "@/evals";
import { getEvals } from "@/evals/server";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";
import { isNotice, NOTICES, noticeQuery } from "../notices";
import { EvalRunsTable, evalRunFormat } from "../../evaluations/run-views";
import { PlaybookVersionFields } from "../version-fields";
import "../../section.css";

type Params = Promise<{ id: string }>;

/** `aria-current` of the link to the version shown. */
const CURRENT = "page";
/** The edit form's field ids start with this. */
const EDIT_FORM = "edit-playbook";

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
  const caseFields = (evalCase?: PlaybookEvalCase) => (
    <>
      <Field label={t("admin.evals.cases.fields.title")}>
        <TextInput name="title" required maxLength={120} lang="fr" defaultValue={evalCase?.title} />
      </Field>
      <Field label={t("admin.evals.cases.fields.context")} hint={t("admin.evals.cases.fields.contextHelp")}>
        <Textarea name="context" required lang="fr" defaultValue={evalCase?.context} />
      </Field>
      <Field label={t("admin.evals.cases.fields.message")}>
        <Textarea name="message" required lang="fr" defaultValue={evalCase?.message} />
      </Field>
      <Field label={t("admin.evals.cases.fields.inViewKind")}>
        <Select name="inViewKind" defaultValue={evalCase?.inView?.kind ?? ""}>
          <option value="">{t("admin.evals.cases.fields.inViewNone")}</option>
          {EVAL_IN_VIEW_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {t(`admin.evals.cases.inViewKinds.${kind}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("admin.evals.cases.fields.inViewText")} hint={t("admin.evals.cases.fields.inViewTextHelp")}>
        <Textarea name="inViewText" rows={4} lang="fr" defaultValue={evalCase?.inView?.text} />
      </Field>
      <Field label={t("admin.evals.cases.fields.criteria")} hint={t("admin.evals.cases.fields.criteriaHelp")}>
        <Textarea name="criteria" required lang="fr" defaultValue={evalCase?.criteria} />
      </Field>
    </>
  );

  return (
    <BackOfficeLayout access={access} title={title}>
      <div className="section-page">
        <p>
          <Link href={routes.adminCoachingPlaybooks}>{t("admin.coachingPlaybooks.detail.back")}</Link>
        </p>
        <p className="section-lead">
          <code>{playbook.id}</code> · {t(playbook.archived ? "admin.coachingPlaybooks.archived" : "admin.coachingPlaybooks.active")} · {t("admin.coachingPlaybooks.served")} :{" "}
          {playbook.served ? t("admin.coachingPlaybooks.version", { version: String(playbook.served.version) }) : t("admin.coachingPlaybooks.none")}
        </p>
        {canWrite ? null : <Note>{t("admin.readOnly")}</Note>}
        {shown ? (
          <Note tone={NOTICES[shown] ? "danger" : "success"} role={NOTICES[shown] ? "alert" : "status"}>
            {t(`admin.coachingPlaybooks.notices.${shown}`, { version: requested ?? "", sources: detail ?? "", list: detail ?? "" })}
          </Note>
        ) : null}

        <nav className="section-block" aria-labelledby="versions-title">
          <h2 id="versions-title">{t("admin.coachingPlaybooks.detail.versions")}</h2>
          <ul className="section-list">
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
                  <span className="section-meta">({tags.join(", ")})</span>
                </li>
              );
            })}
          </ul>
        </nav>

        {selected ? (
          <section aria-labelledby="version-title">
            <Card title={<span id="version-title">{t("admin.coachingPlaybooks.detail.versionTitle", { version: String(selected.version) })}</span>}>
              <div className="section-block">
                <Properties>
                  <Property term={t("admin.coachingPlaybooks.detail.authors")}>
                    {selected.authors.map((author) => (author === IMPORT_AUTHOR ? t("admin.coachingPlaybooks.detail.importAuthor") : author)).join(", ")}
                  </Property>
                  <Property term={t("admin.coachingPlaybooks.detail.createdAt")}>{at.format(selected.createdAt)}</Property>
                  <Property term={t("admin.coachingPlaybooks.detail.updatedAt")}>{at.format(selected.updatedAt)}</Property>
                  <Property term={t("admin.coachingPlaybooks.detail.validation")}>
                    {selected.validation
                      ? t("admin.coachingPlaybooks.validatedBy", { name: `${selected.validation.name} (${selected.validation.email})`, date: at.format(selected.validation.at) })
                      : t("admin.coachingPlaybooks.notValidated")}
                  </Property>
                  {selected.agent ? (
                    <>
                      <Property term={t("admin.coachingPlaybooks.agent")}>
                        {t("admin.coachingPlaybooks.agentSummary", {
                          provider: selected.agent.provider,
                          model: selected.agent.model ?? t("admin.coachingPlaybooks.providerDefault"),
                          effort: selected.agent.effort ? t(`admin.coachingPlaybooks.efforts.${selected.agent.effort}`) : t("admin.coachingPlaybooks.effortDefault"),
                        })}
                        {effortOf(models, selected.agent.provider, selected.agent.model) === "native"
                          ? null
                          : ` (${t(`admin.coachingPlaybooks.effortHandling.${effortOf(models, selected.agent.provider, selected.agent.model)}`)})`}
                      </Property>
                      {playbook.kind === "task" ? null : (
                        <Property term={t("admin.coachingPlaybooks.fields.consultWhen")} lang="fr">
                          {selected.agent.consultWhen}
                        </Property>
                      )}
                    </>
                  ) : playbook.kind === "task" ? (
                    <Property term={t("admin.coachingPlaybooks.tasks.runBy")}>{t("admin.coachingPlaybooks.detail.taskWebSearch")}</Property>
                  ) : null}
                  {task?.search ? (
                    <Property term={t("admin.coachingPlaybooks.detail.search")}>
                      {selected.search ? `${selected.search.provider} · ${selected.search.model ?? t("admin.coachingPlaybooks.providerDefault")}` : t("admin.coachingPlaybooks.fields.searchConfigured")}
                    </Property>
                  ) : null}
                </Properties>
                <h3>{t(playbook.kind === "task" ? "admin.coachingPlaybooks.detail.instructions" : "admin.coachingPlaybooks.detail.rules")}</h3>
                <pre className="section-text" data-boxed data-playbook-rules lang="fr">
                  {selected.content}
                </pre>
              </div>
            </Card>
          </section>
        ) : (
          <Note tone="danger" role="alert">
            {t("admin.coachingPlaybooks.detail.noVersion")}
          </Note>
        )}

        {latest.validation ? null : (
          <BackOfficeForm canWrite={canWrite} action={validatePlaybook}>
            <Card title={t("admin.coachingPlaybooks.detail.validateTitle", { version: String(latest.version) })}>
              <fieldset className="section-form" disabled={!canWrite}>
                <p>{t("admin.coachingPlaybooks.detail.validateHelp")}</p>
                {isPlaybook ? (
                  <>
                    <Properties>
                      <Property term={t("admin.evals.validation.onLatest", { version: String(latest.version) })}>{runLine(runOnLatest, t("admin.evals.validation.noRunOnLatest"))}</Property>
                      {playbook.served ? (
                        <Property term={t("admin.evals.validation.onServed", { version: String(playbook.served.version) })}>{runLine(runOnServed, t("admin.evals.validation.noRunOnServed"))}</Property>
                      ) : (
                        <Property term={t("admin.evals.validation.noneServed")}>—</Property>
                      )}
                    </Properties>
                    <p className="section-meta">{t("admin.evals.validation.noScoreBlocks")}</p>
                  </>
                ) : null}
                <input type="hidden" name="playbookId" value={playbook.id} />
                <input type="hidden" name="version" value={latest.version} />
                <Field label={t("admin.coachingPlaybooks.detail.validatorName")}>
                  <TextInput name="name" required autoComplete="name" defaultValue={accountName} />
                </Field>
                <button className={buttonClass({ variant: "primary" })} type="submit">
                  {t("admin.coachingPlaybooks.detail.validate", { version: String(latest.version) })}
                </button>
              </fieldset>
            </Card>
          </BackOfficeForm>
        )}

        {isPlaybook ? (
          <section className="section-block" id="eval-cases" aria-labelledby="eval-cases-title">
            <h2 id="eval-cases-title">{t("admin.evals.cases.title")}</h2>
            <p>{t("admin.evals.cases.intro")}</p>
            {evalCases.length === 0 ? <p>{t("admin.evals.cases.none")}</p> : null}
            {evalCases.map((evalCase) => (
              <article key={evalCase.id} aria-labelledby={`case-${evalCase.id}-title`}>
                <Card
                  title={<span id={`case-${evalCase.id}-title`}>{evalCase.title}</span>}
                  headingLevel={3}
                  actions={
                    canWrite ? (
                      // Its edit form in a Drawer drawn inside the case, so the form stays the case's.
                      <Drawer inPlace title={evalCase.title} trigger={<Button size="sm">{t("admin.evals.cases.edit")}</Button>}>
                        <div className="section-block">
                          <BackOfficeForm canWrite={canWrite} action={saveEvalCase} className="section-form">
                            <input type="hidden" name="playbookId" value={playbook.id} />
                            <input type="hidden" name="caseId" value={evalCase.id} />
                            {caseFields(evalCase)}
                            <button className={buttonClass({ variant: "primary" })} type="submit">
                              {t("admin.evals.cases.save")}
                            </button>
                          </BackOfficeForm>
                          <BackOfficeForm canWrite={canWrite} action={removeEvalCase}>
                            <input type="hidden" name="playbookId" value={playbook.id} />
                            <input type="hidden" name="caseId" value={evalCase.id} />
                            <button className={buttonClass({ variant: "danger" })} type="submit">
                              {t("admin.evals.cases.remove")}
                            </button>
                          </BackOfficeForm>
                        </div>
                      </Drawer>
                    ) : null
                  }
                >
                  <div className="section-block">
                    <p className="section-meta">{t("admin.evals.cases.writtenBy", { author: evalCase.author, date: at.format(evalCase.updatedAt) })}</p>
                    <Properties>
                      <Property term={t("admin.evals.run.context")} lang="fr">
                        {evalCase.context}
                      </Property>
                      <Property term={t("admin.evals.run.message")} lang="fr">
                        {evalCase.message}
                      </Property>
                      {evalCase.inView ? (
                        <Property term={t("admin.evals.run.inView")} lang="fr">
                          {t(`admin.evals.cases.inViewKinds.${evalCase.inView.kind}`)} : {evalCase.inView.text}
                        </Property>
                      ) : null}
                      <Property term={t("admin.evals.run.criteria")} lang="fr">
                        {evalCase.criteria}
                      </Property>
                    </Properties>
                  </div>
                </Card>
              </article>
            ))}
            <BackOfficeForm canWrite={canWrite} action={addEvalCase}>
              <Card title={t("admin.evals.cases.add")} headingLevel={3}>
                <fieldset className="section-form" disabled={!canWrite}>
                  <input type="hidden" name="playbookId" value={playbook.id} />
                  {caseFields()}
                  <button className={buttonClass({ variant: "primary" })} type="submit">
                    {t("admin.evals.cases.addButton")}
                  </button>
                </fieldset>
              </Card>
            </BackOfficeForm>
          </section>
        ) : null}

        {isPlaybook ? (
          <section className="section-block" id="eval-runs" aria-labelledby="eval-runs-title">
            <h2 id="eval-runs-title">{t("admin.evals.runs.title")}</h2>
            <p>{t("admin.evals.runs.intro")}</p>
            <BackOfficeForm canWrite={canRun} action={startEvalRun}>
              <Card title={t("admin.evals.runs.start", { version: String(latest.version) })} headingLevel={3}>
                <fieldset className="section-form" disabled={!canRun}>
                  <p id="eval-run-help" className="section-meta">
                    {t("admin.evals.runs.startHelp")}
                  </p>
                  <input type="hidden" name="playbookId" value={playbook.id} />
                  <Field label={t("admin.evals.runs.version")}>
                    <Select name="version" defaultValue={String(latest.version)}>
                      {[latest, ...(playbook.served && playbook.served.version !== latest.version ? [playbook.served] : [])].map((version) => (
                        <option key={version.version} value={version.version}>
                          {versionName(version.version)}
                          {version.version === playbook.served?.version ? ` (${t("admin.coachingPlaybooks.detail.servedTag")})` : ""}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t("admin.evals.runs.model")}>
                    <Select name="agentModel" defaultValue="" aria-describedby="eval-run-help">
                      <option value="">{t("admin.evals.runs.agentAsSaved")}</option>
                      {models.map((choice) => (
                        <optgroup key={choice.provider} label={`${choice.provider} (${choice.endpoint})`}>
                          <option value={agentModelValue(choice.provider, null)}>{`${choice.provider} · ${defaultModelLabel(t, choice)}`}</option>
                          {choice.models.map((each) => (
                            <option key={each.model} value={agentModelValue(choice.provider, each.model)}>
                              {`${choice.provider} · ${each.model}`}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t("admin.evals.runs.effort")}>
                    <Select name="effort" defaultValue="">
                      <option value="">{t("admin.evals.runs.agentAsSaved")}</option>
                      {EFFORTS.map((effort) => (
                        <option key={effort} value={effort}>
                          {t(`admin.coachingPlaybooks.efforts.${effort}`)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <p className="section-meta">{t("admin.evals.runs.running")}</p>
                  <button className={buttonClass({ variant: "primary" })} type="submit" disabled={evalCases.length === 0}>
                    {t("admin.evals.runs.startButton")}
                  </button>
                </fieldset>
              </Card>
            </BackOfficeForm>
            <EvalRunsTable runs={runs} caption={t("admin.evals.runs.caption")} />
          </section>
        ) : null}

        <BackOfficeForm canWrite={canWrite} action={savePlaybook}>
          <Card title={t("admin.coachingPlaybooks.detail.editTitle")}>
            <fieldset className="section-form" disabled={!canWrite}>
              <p>
                {latest.validation
                  ? t("admin.coachingPlaybooks.detail.editValidated", { version: String(latest.version), next: String(latest.version + 1) })
                  : t("admin.coachingPlaybooks.detail.editDraft", { version: String(latest.version) })}
              </p>
              <input type="hidden" name="playbookId" value={playbook.id} />
              <PlaybookVersionFields idPrefix={EDIT_FORM} kind={playbook.kind} version={latest} models={models} searchModels={searchModels} task={task} />
              <button className={buttonClass({ variant: "primary" })} type="submit">
                {t("admin.coachingPlaybooks.detail.save")}
              </button>
            </fieldset>
          </Card>
        </BackOfficeForm>

        {playbook.kind === "playbook" || playbook.kind === "task" ? (
          <BackOfficeForm canWrite={canWrite} action={archivePlaybook}>
            <Card title={t("admin.coachingPlaybooks.detail.archiveTitle")}>
              <div className="section-form">
                <p>{t(playbook.kind === "task" ? "admin.coachingPlaybooks.detail.taskArchiveHelp" : "admin.coachingPlaybooks.detail.archiveHelp")}</p>
                <input type="hidden" name="playbookId" value={playbook.id} />
                <input type="hidden" name="archived" value={String(!playbook.archived)} />
                <button className={buttonClass({ variant: playbook.archived ? "secondary" : "danger" })} type="submit" disabled={!canWrite}>
                  {t(playbook.archived ? "admin.coachingPlaybooks.detail.restore" : "admin.coachingPlaybooks.detail.archive")}
                </button>
              </div>
            </Card>
          </BackOfficeForm>
        ) : null}
      </div>
    </BackOfficeLayout>
  );
}
