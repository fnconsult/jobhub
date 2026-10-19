import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { effortOf, playbookVersionFromForm } from "@/admin/playbook-form";
import { getCoachingPlaybooksBackOffice, requireBackOffice } from "@/admin/server";
import { getAi } from "@/ai/server";
import { getCurrentCandidate } from "@/auth/server";
import { IMPORT_AUTHOR, type PlaybookVersion } from "@/coaching-playbooks";
import { getCoachingPlaybooks } from "@/coaching-playbooks/server";
import { BackOfficeForm } from "@/components/BackOfficeForm";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";
import { isNotice, NOTICES, noticeQuery } from "../notices";
import { PlaybookVersionFields } from "../version-fields";

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

async function archivePlaybook(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("coachingPlaybooks", "write");
  const id = String(form.get("playbookId"));
  const archived = form.get("archived") === "true";
  const done = await getCoachingPlaybooksBackOffice().setArchived(administrator, id, archived);
  back(id, done.ok ? noticeQuery(archived ? "archived" : "restored") : noticeQuery(done));
}

/** One Coaching Playbook, the Core Digest or the Sources list (#225): its versions, one of them in full, and what a Playbook editor can do. */
export default async function CoachingPlaybookPage({ params, searchParams }: { params: Params; searchParams: Promise<{ version?: string; notice?: string; detail?: string }> }) {
  const { access, canWrite } = await requireBackOffice("coachingPlaybooks");
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const { id } = await params;
  const { version: requested, notice, detail } = await searchParams;
  const history = await getCoachingPlaybooks().history(decodeURIComponent(id));
  if (!history) notFound();
  const { playbook, versions } = history;
  const models = getAi().agentModels();
  const shown = isNotice(notice) ? notice : null;
  const selected: PlaybookVersion | undefined = requested ? versions.find((version) => String(version.version) === requested) : playbook.latest;
  const at = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" });
  const title = playbook.kind === "playbook" ? playbook.title : t(`admin.coachingPlaybooks.kinds.${playbook.kind}`);
  const versionName = (version: number) => t("admin.coachingPlaybooks.detail.versionLink", { version: String(version) });
  const accountName = (await getCurrentCandidate())?.name?.trim() ?? "";
  const latest = playbook.latest;

  return (
    <BackOfficeLayout access={access}>
      <p>
        <Link href={routes.adminCoachingPlaybooks}>{t("admin.coachingPlaybooks.detail.back")}</Link>
      </p>
      <h1>{title}</h1>
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
                    effort: t(`admin.coachingPlaybooks.efforts.${selected.agent.effort}`),
                  })}
                  {effortOf(models, selected.agent.provider, selected.agent.model) === "native"
                    ? null
                    : ` (${t(`admin.coachingPlaybooks.effortHandling.${effortOf(models, selected.agent.provider, selected.agent.model)}`)})`}
                </dd>
                <dt>{t("admin.coachingPlaybooks.fields.consultWhen")}</dt>
                <dd lang="fr">{selected.agent.consultWhen}</dd>
              </>
            ) : null}
          </dl>
          <h3>{t("admin.coachingPlaybooks.detail.rules")}</h3>
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
          <PlaybookVersionFields idPrefix={EDIT_FORM} kind={playbook.kind} version={latest} models={models} />
          <button className="button button-primary" type="submit">
            {t("admin.coachingPlaybooks.detail.save")}
          </button>
        </fieldset>
      </BackOfficeForm>

      {playbook.kind === "playbook" ? (
        <BackOfficeForm canWrite={canWrite} className="stack" action={archivePlaybook}>
          <h2>{t("admin.coachingPlaybooks.detail.archiveTitle")}</h2>
          <p>{t("admin.coachingPlaybooks.detail.archiveHelp")}</p>
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
