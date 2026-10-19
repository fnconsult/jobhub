import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { playbookVersionFromForm } from "@/admin/playbook-form";
import { getCoachingPlaybooksBackOffice, requireBackOffice } from "@/admin/server";
import { getAi } from "@/ai/server";
import type { CoachingPlaybook, PlaybookKind, PlaybookVersion } from "@/coaching-playbooks";
import { getCoachingPlaybooks } from "@/coaching-playbooks/server";
import { playbookServing } from "@/coaching-playbooks/serving";
import { BackOfficeForm } from "@/components/BackOfficeForm";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";
import { isNotice, NOTICES, noticeQuery } from "./notices";
import { PlaybookVersionFields } from "./version-fields";

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
  const playbooks = await getCoachingPlaybooks().list();
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
    <div className="table-scroll">
      <table className="application-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{t("admin.coachingPlaybooks.name")}</th>
            <th scope="col">{t("admin.coachingPlaybooks.latest")}</th>
            <th scope="col">{t("admin.coachingPlaybooks.served")}</th>
            <th scope="col">{agentHeading}</th>
            <th scope="col">{t("admin.coachingPlaybooks.status")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((playbook) => {
            const agent = playbook.latest.agent;
            return (
              <tr key={playbook.id}>
                <th scope="row">
                  <Link href={routes.adminCoachingPlaybook(playbook.id)}>{name(playbook)}</Link> <code>{playbook.id}</code>
                </th>
                <td>{versionLine(playbook.latest)}</td>
                <td>{playbook.served ? t("admin.coachingPlaybooks.version", { version: String(playbook.served.version) }) : t("admin.coachingPlaybooks.none")}</td>
                <td>
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
                </td>
                <td>{t(playbook.archived ? "admin.coachingPlaybooks.archived" : "admin.coachingPlaybooks.active")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <BackOfficeLayout access={access} title={t("admin.coachingPlaybooks.title")}>
      <p className="lead">{t("admin.coachingPlaybooks.intro")}</p>
      <p>{t(playbookServing(process.env) === "validated" ? "admin.coachingPlaybooks.servingValidated" : "admin.coachingPlaybooks.servingLatest")}</p>
      {canWrite ? null : <p className="notice">{t("admin.readOnly")}</p>}
      {shown ? (
        <p className="notice" role={NOTICES[shown] ? "alert" : "status"}>
          {t(`admin.coachingPlaybooks.notices.${shown}`, { sources: detail ?? "", list: detail ?? "", version: "" })}
        </p>
      ) : null}

      {playbooksTable(t("admin.coachingPlaybooks.caption"), t("admin.coachingPlaybooks.agent"), coaching)}

      <section className="stack" aria-labelledby="tasks-title">
        <h2 id="tasks-title">{t("admin.coachingPlaybooks.tasks.title")}</h2>
        <p>{t("admin.coachingPlaybooks.tasks.intro")}</p>
        {playbooksTable(t("admin.coachingPlaybooks.tasks.caption"), t("admin.coachingPlaybooks.tasks.runBy"), tasks)}
      </section>

      <section className="stack" aria-labelledby="models-title">
        <h2 id="models-title">{t("admin.coachingPlaybooks.models.title")}</h2>
        <p>{t("admin.coachingPlaybooks.fields.modelHelp")}</p>
        <div className="table-scroll">
          <table className="application-table">
            <caption>{t("admin.coachingPlaybooks.models.caption")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("admin.coachingPlaybooks.models.provider")}</th>
                <th scope="col">{t("admin.coachingPlaybooks.models.model")}</th>
                <th scope="col">{t("admin.coachingPlaybooks.models.residency")}</th>
                <th scope="col">{t("admin.coachingPlaybooks.models.effort")}</th>
              </tr>
            </thead>
            <tbody>
              {models.flatMap((choice) =>
                choice.models.map((each) => (
                  <tr key={`${choice.provider} ${each.model}`}>
                    <th scope="row">{`${choice.provider} (${choice.endpoint})`}</th>
                    <td>{each.model}</td>
                    <td>{t(each.residency === "eu" ? "admin.coachingPlaybooks.models.inEu" : "admin.coachingPlaybooks.outsideEu")}</td>
                    <td>{each.effort === "native" ? t("admin.coachingPlaybooks.models.native") : t(`admin.coachingPlaybooks.effortHandling.${each.effort}`)}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </section>

      <BackOfficeForm canWrite={canWrite} className="stack quota-form" action={createPlaybook}>
        <fieldset disabled={!canWrite}>
          <legend>
            <h2>{t("admin.coachingPlaybooks.create.title")}</h2>
          </legend>
          <div className="stack">
            <label htmlFor="new-playbook-id">{t("admin.coachingPlaybooks.fields.id")}</label>
            <input id="new-playbook-id" className="input" name="id" required pattern="[a-z0-9]+(-[a-z0-9]+)*" autoComplete="off" aria-describedby="new-playbook-id-help" />
            <p id="new-playbook-id-help">{t("admin.coachingPlaybooks.fields.idHelp")}</p>
          </div>
          <PlaybookVersionFields idPrefix={CREATE_FORM} kind={PLAYBOOK} models={models} />
          <button className="button button-primary" type="submit">
            {t("admin.coachingPlaybooks.create.submit")}
          </button>
        </fieldset>
      </BackOfficeForm>
    </BackOfficeLayout>
  );
}
