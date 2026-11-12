import type { Metadata } from "next";
import Link from "next/link";
import type { ActivityTabId } from "@/admin/activity";
import { requireBackOffice } from "@/admin/server";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { PageIntro } from "@/components/PageIntro";
import { buttonClass } from "@/design/button-class";
import { Field, Select, TextInput } from "@/design/Field";
import { Note } from "@/design/Note";
import { Status } from "@/design/Pill";
import { Table } from "@/design/Table";
import { EXTENSION_EVENT_WHO, extensionEventsFilter, LIST_LIMIT, type ListedExtensionEvent } from "@/extension-events/back-office";
import { EXTENSION_EVENT_KINDS, GUEST_RETENTION_DAYS, RETENTION_MONTHS } from "@/extension-events/index";
import { getExtensionEventsBackOffice } from "@/extension-events/server";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";
import { ActivityTabs } from "../ActivityTabs";
import "../activite.css";

type Search = Record<string, string | string[] | undefined>;

/** This tab of Activité (#925). */
const TAB: ActivityTabId = "extensionEvents";
/** The table's hook for the tests. */
const TEST_ID = "extension-events";

export async function generateMetadata(): Promise<Metadata> {
  // Metadata renders apart from the page: without this, the 404 shown to
  // non-Administrators would still carry the back office's title.
  await requireBackOffice("extensionEvents");
  const t = await getServerT();
  return { title: `${t("admin.activity.tabs.extensionEvents")} · ${t("admin.activity.title")} · ${t("admin.title")}`, robots: { index: false } };
}

/**
 * Activité › Extension (#925): every Extension Event (#924), newest first: when, its type, the Candidate (their email, a
 * link to their Extension Events alone) or « Invité », the Extension Version, its object (a Job Offer's page; a Profile or
 * an Application is its Candidate's own, named by its id) and, for an error, its code, where it happened, the route and
 * status, the browser and the page's domain. Filtered by type (« Erreurs » among them), Candidate or Invité, one
 * Candidate, version and domain; the LIST_LIMIT newest at most, as Activité's other tabs. Super-admins, Technique and
 * Support read it, as they read Activité.
 */
export default async function ExtensionEventsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { access } = await requireBackOffice("extensionEvents");
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const search = await searchParams;
  const filter = extensionEventsFilter(search);
  const rows = await getExtensionEventsBackOffice().list(search);
  const at = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "medium", timeZone: "Europe/Paris" });
  const none = <span className="activity-meta">{t("admin.extensionEvents.noValue")}</span>;

  const object = (row: ListedExtensionEvent) => {
    if (!row.object) return none;
    const label = `${t(`admin.extensionEvents.objects.${row.object.type}`)} ${row.object.id.slice(0, 8)}`;
    // A Job Offer has its page; a Profile and an Application are their Candidate's own, with none in the Back Office.
    return row.object.type === "job_offer" ? (
      <Link href={routes.jobOffer(row.object.id)} prefetch={false}>
        {label}
      </Link>
    ) : (
      label
    );
  };

  const error = (row: ListedExtensionEvent) => {
    if (!row.error) return none;
    const { code, place, route, httpStatus, browser, pageDomain } = row.error;
    const details = [
      place ? t(`admin.extensionEvents.places.${place}`) : null,
      route ? t("admin.extensionEvents.routeStatus", { route, status: httpStatus === 0 ? t("admin.extensionEvents.network") : (httpStatus ?? "") }) : null,
      browser,
      pageDomain,
    ].filter((detail): detail is string => Boolean(detail));
    return (
      <>
        <code>{code}</code>
        {details.length ? <div className="activity-meta">{details.join(" · ")}</div> : null}
      </>
    );
  };

  return (
    <BackOfficeLayout access={access} title={t("admin.activity.title")}>
      <div className="activite">
        <ActivityTabs access={access} shown={TAB} />
        <PageIntro t={t} page={TAB} subject={t("admin.activity.tabs.extensionEvents")} values={{ months: String(RETENTION_MONTHS), days: String(GUEST_RETENTION_DAYS) }} />

        {filter.candidate ? (
          <Note role="status">
            <p>{t("admin.extensionEvents.ofCandidate")}</p>
          </Note>
        ) : null}
        <form method="get" action={routes.adminExtensionEvents()} className="activity-filter" aria-label={t("admin.extensionEvents.filter")}>
          {/* One Candidate's Extension Events: they stay while the other filters change. */}
          {filter.candidate ? <input type="hidden" name="candidat" value={filter.candidate} /> : null}
          <Field label={t("admin.extensionEvents.kind")}>
            <Select name="type" defaultValue={filter.kind ?? ""}>
              <option value="">{t("admin.extensionEvents.anyKind")}</option>
              {EXTENSION_EVENT_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind === "error" ? t("admin.extensionEvents.errorsFilter") : t(`admin.extensionEvents.kinds.${kind}`)}
                </option>
              ))}
            </Select>
          </Field>
          {filter.candidate ? null : (
            <Field label={t("admin.extensionEvents.who")}>
              <Select name="qui" defaultValue={filter.who ?? ""}>
                <option value="">{t("admin.extensionEvents.anyone")}</option>
                {EXTENSION_EVENT_WHO.map((who) => (
                  <option key={who} value={who}>
                    {t(`admin.extensionEvents.whos.${who}`)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label={t("admin.extensionEvents.version")}>
            <TextInput name="version" defaultValue={filter.version ?? ""} inputMode="decimal" />
          </Field>
          <Field label={t("admin.extensionEvents.domain")}>
            <TextInput name="domaine" defaultValue={filter.domain ?? ""} />
          </Field>
          <div className="activity-filter-actions">
            <button type="submit" className={buttonClass()}>
              {t("admin.extensionEvents.apply")}
            </button>{" "}
            <Link href={routes.adminExtensionEvents()}>{t("admin.extensionEvents.reset")}</Link>
          </div>
        </form>

        {rows.length === 0 ? (
          <p>{t("admin.extensionEvents.none")}</p>
        ) : (
          <>
            <p>{t("admin.extensionEvents.count", { count: rows.length })}</p>
            {rows.length >= LIST_LIMIT ? <p>{t("admin.extensionEvents.limit", { count: String(LIST_LIMIT) })}</p> : null}
            <Table
              label={t("admin.extensionEvents.caption")}
              data-testid={TEST_ID}
              columns={[
                { header: t("admin.extensionEvents.at"), rowHeader: true, cell: (row) => <time dateTime={row.at.toISOString()}>{at.format(row.at)}</time> },
                {
                  header: t("admin.extensionEvents.kind"),
                  cell: (row) => (row.kind === "error" ? <Status tone="danger">{t("admin.extensionEvents.kinds.error")}</Status> : t(`admin.extensionEvents.kinds.${row.kind}`)),
                },
                {
                  header: t("admin.extensionEvents.candidate"),
                  cell: (row) =>
                    row.candidate ? (
                      <Link href={routes.adminExtensionEvents({ candidate: row.candidate.id })} prefetch={false} aria-label={t("admin.extensionEvents.candidateLink", { email: row.candidate.email })}>
                        {row.candidate.email}
                      </Link>
                    ) : (
                      t("admin.extensionEvents.guest")
                    ),
                },
                { header: t("admin.extensionEvents.version"), cell: (row) => (row.extensionVersion ? <code>{row.extensionVersion}</code> : none) },
                { header: t("admin.extensionEvents.object"), cell: object },
                { header: t("admin.extensionEvents.error"), cell: error },
              ]}
              rows={rows}
              rowKey={(row) => row.id}
              rowAttributes={(row) => ({ "data-extension-event": row.id, "data-kind": row.kind })}
            />
          </>
        )}
      </div>
    </BackOfficeLayout>
  );
}
