import { APPLICATION_STATUSES } from "@jobhub/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { INTERVIEW_TIME_ZONE, type ApplicationSummary } from "@/applications";
import { getApplications } from "@/applications/server";
import { applicationListHref, applicationListView, isArchivedApplication, viewApplications, type ApplicationListParams, type ApplicationListView, type ApplicationSort } from "@/applications/list-view";
import { getCurrentCandidate } from "@/auth/server";
import { FOLLOW_UP_CARD, type FollowUpNotice } from "@/follow-ups";
import { getFollowUps } from "@/follow-ups/server";
import { ApplicationStatusSelect } from "@/components/ApplicationControls";
import { CandidateLayout } from "@/components/CandidateLayout";
import { EmptyStateHelp, HelpTerm } from "@/components/HelpTerm";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { getProfiles } from "@/profiles/server";
import { routes } from "@/routes";
import { buttonClass } from "@/design/button-class";
import { EmptyState } from "@/design/EmptyState";
import { Checkbox, Field, Select } from "@/design/Field";
import { Note } from "@/design/Note";
import { Pill } from "@/design/Pill";
import { Table, type Column } from "@/design/Table";
import "./candidatures.css";

/** `aria-current` of the link to the view being shown. */
const CURRENT = "page";
/** The address's values for the board view and the reversed order (see list-view). */
const BOARD = "tableau";
const DESCENDING = "desc";
/** The sort marks beside a column header: decoration, the order is said in words too. */
const SORT_MARKS = { asc: "▲", desc: "▼" } as const;
const UNSORTED_MARK = "↕";

type T = Awaited<ReturnType<typeof getServerT>>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("applications.title")} · ${t("app.name")}` };
}

/** The column headers that sort the list, with their words. */
const SORT_LABELS = { offre: "applications.jobOffer", profil: "applications.profile", entretiens: "applications.interviews", statut: "applications.status" } as const satisfies Record<ApplicationSort, string>;

/**
 * The Candidate's Applications, as a list (by default) or as a board with one column per
 * Application Status, filtered by Profile and Status and sorted by a column, all in the
 * address. Archived Applications (an end state, or an archived Profile) are hidden until asked for.
 * Drawn in the Design System's Confort Density (#467): the filters as Fields, the list as a Table, the board's cards,
 * the follow-ups to do as a Note, and its empty state.
 */
export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<{ vue?: string } & ApplicationListParams> }) {
  const candidate = await getCurrentCandidate();
  if (!candidate) redirect(routes.signIn);
  const [t, locale, applications, notices, profiles, params] = await Promise.all([
    getServerT(),
    getRequestLocale(),
    getApplications().list(candidate.id),
    getFollowUps().notices(candidate.id),
    getProfiles().list(candidate.id),
    searchParams,
  ]);
  const board = params.vue === BOARD;
  const view = applicationListView(params);
  // The filters' form sends its empty choices too: keep the address to what is chosen.
  const canonical = applicationListHref(routes.applications, view, { board });
  if (Object.entries(params).some(([key, value]) => key !== "vue" && !value)) redirect(canonical);
  const shown = viewApplications(applications, view, locale);
  // Archived Applications the other filters would show, hidden only for being archived.
  const hiddenArchived = view.showArchived ? 0 : viewApplications(applications, { ...view, showArchived: true }, locale).filter(isArchivedApplication).length - shown.filter(isArchivedApplication).length;
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: INTERVIEW_TIME_ZONE });
  return (
    <CandidateLayout candidateId={candidate.id} wide={board} title={t("applications.title")}>
      <FollowUpNotices notices={notices} waiting={applications.some(isWaitingForNews)} t={t} />
      {applications.length === 0 ? (
        <EmptyState
          title={t("applications.emptyTitle")}
          actions={
            <Link className={buttonClass({ variant: "primary" })} href={routes.jobSearches()}>
              {t("jobSearch.start")}
            </Link>
          }
          help={<EmptyStateHelp of="applications" />}
        >
          {t("applications.none")}
        </EmptyState>
      ) : (
        <>
          {/* One row: the filters, then the List and Board switch at its far end. */}
          <div className="applications-toolbar">
            <Filters view={view} board={board} profiles={profiles} t={t} />
            <nav className="applications-views" aria-label={t("applications.viewsLabel")}>
              <Link className={buttonClass({ size: "sm", variant: board ? "quiet" : "secondary" })} href={applicationListHref(routes.applications, view)} aria-current={board ? undefined : CURRENT}>
                {t("applications.listView")}
              </Link>
              <Link className={buttonClass({ size: "sm", variant: board ? "secondary" : "quiet" })} href={applicationListHref(routes.applications, view, { board: true })} aria-current={board ? CURRENT : undefined}>
                {t("applications.boardView")}
              </Link>
            </nav>
          </div>
          {hiddenArchived > 0 ? <p className="applications-hint">{t("applications.archivedHidden", { count: hiddenArchived })}</p> : null}
          {shown.length === 0 ? (
            <Note>{t("applications.noneMatch")}</Note>
          ) : board ? (
            <Board applications={shown} t={t} />
          ) : (
            <List applications={shown} view={view} t={t} formatDate={(value) => date.format(value)} />
          )}
        </>
      )}
    </CandidateLayout>
  );
}

/** At « Postulée » or « Relancée », an Application waits for the employer's news: a Relance may come. */
const isWaitingForNews = (application: ApplicationSummary) => application.status === "applied" || application.status === "followed_up";

/**
 * The in-app notice: Applications with a Follow-up or an "Abandonnée" suggestion waiting for the Candidate. With none,
 * while some Application `waiting` for news may get one, the empty state says so, with its link to the help (#343).
 */
function FollowUpNotices({ notices, waiting, t }: { notices: FollowUpNotice[]; waiting: boolean; t: T }) {
  if (notices.length === 0) {
    return waiting ? (
      <p className="applications-hint">
        {t("followUps.noneWaiting")} <EmptyStateHelp of="followUps" />
      </p>
    ) : null;
  }
  return (
    <section className="applications-follow-ups" aria-labelledby="follow-up-notices-title">
      <Note title={<HelpTerm term="followUp">{t("followUps.noticesTitle")}</HelpTerm>}>
        <h2 id="follow-up-notices-title" className="visually-hidden">
          {t("followUps.noticesTitle")}
        </h2>
        <ul>
          {notices.map((notice) => (
            <li key={notice.applicationId}>
              <Link href={routes.application(notice.applicationId)}>
                {t(notice.kind === FOLLOW_UP_CARD ? "followUps.noticeFollowUp" : "followUps.noticeAbandon", { title: notice.jobTitle })}
              </Link>
            </li>
          ))}
        </ul>
      </Note>
    </section>
  );
}

/**
 * The filters: a plain form sent by its button, so it works without scripts and its
 * choices land in the address (a reload or a shared link keeps them).
 */
function Filters({ view, board, profiles, t }: { view: ApplicationListView; board: boolean; profiles: { id: string; name: string; archived: boolean }[]; t: T }) {
  const filtered = view.profileId !== null || view.status !== null || view.showArchived;
  return (
    <form className="applications-filters" method="get" action={routes.applications} aria-label={t("applications.filtersLabel")}>
      {board ? <input type="hidden" name="vue" value={BOARD} /> : null}
      {view.sort ? <input type="hidden" name="tri" value={view.sort} /> : null}
      {view.sort && view.order === "desc" ? <input type="hidden" name="ordre" value={DESCENDING} /> : null}
      <Field label={t("applications.profile")}>
        <Select name="profil" defaultValue={view.profileId ?? ""}>
          <option value="">{t("applications.allProfiles")}</option>
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("applications.status")}>
        <Select name="statut" defaultValue={view.status ?? ""}>
          <option value="">{t("applications.allStatuses")}</option>
          {APPLICATION_STATUSES.map((status) => (
            <option key={status} value={status}>
              {t(`applicationStatuses.${status}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Checkbox name="archivees" value="1" defaultChecked={view.showArchived} label={t("applications.showArchived")} />
      <button className={buttonClass()} type="submit">
        {t("applications.filter")}
      </button>
      {filtered ? (
        <Link className={buttonClass({ variant: "quiet" })} href={applicationListHref(routes.applications, { ...view, profileId: null, status: null, showArchived: false }, { board })}>
          {t("applications.reset")}
        </Link>
      ) : null}
    </form>
  );
}

const jobOfferLabel = (application: ApplicationSummary) =>
  [application.jobOffer.title, application.jobOffer.employer, application.jobOffer.location].filter(Boolean).join(" · ");

/**
 * Flags an Application on an Expired Job Offer, or one the Candidate reported
 * unavailable (Reported Unavailable), in words; its status is left as the Candidate set it.
 */
function ExpiredFlag({ application, t }: { application: ApplicationSummary; t: T }) {
  if (!application.jobOffer.expiredAt && !application.reportedUnavailableAt) return null;
  return (
    <span className="applications-flags">
      <Pill tone="danger">{t("applications.expired")}</Pill>
      {application.reportedUnavailableAt ? <Pill>{t("applications.reportedByYou")}</Pill> : null}
    </span>
  );
}

/** A column header that sorts the list by it; a second click reverses the order. Its column says how it is sorted. */
function SortLink({ sort, view, t }: { sort: ApplicationSort; view: ApplicationListView; t: T }) {
  const current = view.sort === sort;
  const order = current && view.order === "asc" ? "desc" : "asc";
  return (
    <Link className="applications-sort" href={applicationListHref(routes.applications, view, { sort, order })}>
      {t(SORT_LABELS[sort])}
      {current ? <span className="visually-hidden">, {t(view.order === "asc" ? "applications.sortedAscending" : "applications.sortedDescending")}</span> : null}
      <span className="applications-sort__mark" aria-hidden="true">
        {current ? SORT_MARKS[view.order] : UNSORTED_MARK}
      </span>
    </Link>
  );
}

function List({ applications, view, t, formatDate }: { applications: ApplicationSummary[]; view: ApplicationListView; t: T; formatDate: (value: Date) => string }) {
  const header = (sort: ApplicationSort) => ({
    key: sort,
    header: <SortLink sort={sort} view={view} t={t} />,
    sort: view.sort === sort ? (view.order === "asc" ? "ascending" : "descending") : undefined,
  }) as const;
  const columns: Column<ApplicationSummary>[] = [
    {
      ...header("offre"),
      rowHeader: true,
      cell: (application) => (
        <span className="applications-offer">
          <Link href={routes.application(application.id)}>{jobOfferLabel(application)}</Link>
          <ExpiredFlag application={application} t={t} />
        </span>
      ),
    },
    { ...header("profil"), cell: (application) => application.profile.name },
    {
      ...header("entretiens"),
      cell: (application) =>
        application.interviews.length > 0 ? application.interviews.map((interview) => formatDate(interview.scheduledAt)).join(", ") : t("applications.noInterview"),
    },
    {
      ...header("statut"),
      cell: (application) => (
        <div className="applications-status">
          <ApplicationStatusSelect applicationId={application.id} status={application.status} labelHidden />
        </div>
      ),
    },
  ];
  return <Table label={t("applications.title")} columns={columns} rows={applications} rowKey={(application) => application.id} />;
}

function Board({ applications, t }: { applications: ApplicationSummary[]; t: T }) {
  return (
    <div className="applications-board">
      {APPLICATION_STATUSES.map((status) => {
        const inColumn = applications.filter((application) => application.status === status);
        return (
          <section key={status} className="applications-column" aria-labelledby={`column-${status}`}>
            <h2 id={`column-${status}`}>
              {t(`applicationStatuses.${status}`)} <span className="applications-column__count" aria-hidden="true">
                {inColumn.length}
              </span>
            </h2>
            {inColumn.length === 0 ? (
              <p className="applications-column__empty">{t("applications.emptyColumn")}</p>
            ) : (
              <ul className="applications-cards">
                {inColumn.map((application) => (
                  <li key={application.id} className="applications-card">
                    <Link href={routes.application(application.id)}>{jobOfferLabel(application)}</Link>
                    <ExpiredFlag application={application} t={t} />
                    <p>{application.profile.name}</p>
                    {application.interviews.length > 0 ? <p>{t("applications.interviewCount", { number: application.interviews.length })}</p> : null}
                    <ApplicationStatusSelect applicationId={application.id} status={application.status} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
