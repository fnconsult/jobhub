import { APPLICATION_STATUSES } from "@jobhub/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { INTERVIEW_TIME_ZONE, type ApplicationSummary } from "@/applications";
import { getApplications } from "@/applications/server";
import { APPLICATION_SORTS, applicationListHref, applicationListView, isArchivedApplication, viewApplications, type ApplicationListParams, type ApplicationListView, type ApplicationSort } from "@/applications/list-view";
import { getCurrentCandidate } from "@/auth/server";
import { FOLLOW_UP_CARD, type FollowUpNotice } from "@/follow-ups";
import { getFollowUps } from "@/follow-ups/server";
import { ApplicationStatusSelect } from "@/components/ApplicationControls";
import { CandidateLayout } from "@/components/CandidateLayout";
import { EmptyStateHelp, HelpTerm } from "@/components/HelpTerm";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { getProfiles } from "@/profiles/server";
import { routes } from "@/routes";

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
        <p className="notice">
          {t("applications.none")} <EmptyStateHelp of="applications" />
        </p>
      ) : (
        <>
          {/* One row: the filters, then the List and Board switch at its far end. */}
          <div className="list-toolbar">
            <Filters view={view} board={board} profiles={profiles} t={t} />
            <nav className="actions list-views" aria-label={t("applications.viewsLabel")}>
              <Link className="button" href={applicationListHref(routes.applications, view)} aria-current={board ? undefined : CURRENT}>
                {t("applications.listView")}
              </Link>
              <Link className="button" href={applicationListHref(routes.applications, view, { board: true })} aria-current={board ? CURRENT : undefined}>
                {t("applications.boardView")}
              </Link>
            </nav>
          </div>
          {hiddenArchived > 0 ? <p className="hint">{t("applications.archivedHidden", { count: hiddenArchived })}</p> : null}
          {shown.length === 0 ? (
            <p className="notice">{t("applications.noneMatch")}</p>
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
      <p className="hint">
        {t("followUps.noneWaiting")} <EmptyStateHelp of="followUps" />
      </p>
    ) : null;
  }
  return (
    <section className="notice stack" aria-labelledby="follow-up-notices-title">
      <h2 id="follow-up-notices-title">
        <HelpTerm term="followUp">{t("followUps.noticesTitle")}</HelpTerm>
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
    <form className="list-filters" method="get" action={routes.applications} aria-label={t("applications.filtersLabel")}>
      {board ? <input type="hidden" name="vue" value={BOARD} /> : null}
      {view.sort ? <input type="hidden" name="tri" value={view.sort} /> : null}
      {view.sort && view.order === "desc" ? <input type="hidden" name="ordre" value={DESCENDING} /> : null}
      <div className="field">
        <label htmlFor="filter-profile">{t("applications.profile")}</label>
        <select id="filter-profile" name="profil" className="input" defaultValue={view.profileId ?? ""}>
          <option value="">{t("applications.allProfiles")}</option>
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="filter-status">{t("applications.status")}</label>
        <select id="filter-status" name="statut" className="input" defaultValue={view.status ?? ""}>
          <option value="">{t("applications.allStatuses")}</option>
          {APPLICATION_STATUSES.map((status) => (
            <option key={status} value={status}>
              {t(`applicationStatuses.${status}`)}
            </option>
          ))}
        </select>
      </div>
      <label className="checkbox">
        <input type="checkbox" name="archivees" value="1" defaultChecked={view.showArchived} />
        {t("applications.showArchived")}
      </label>
      <button className="button" type="submit">
        {t("applications.filter")}
      </button>
      {filtered ? (
        <Link className="button button-quiet" href={applicationListHref(routes.applications, { ...view, profileId: null, status: null, showArchived: false }, { board })}>
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
    <>
      <span className="expired-flag">{t("applications.expired")}</span>
      {application.reportedUnavailableAt ? <span className="reported-flag">{t("applications.reportedByYou")}</span> : null}
    </>
  );
}

/** A column header that sorts the list by it; a second click reverses the order. */
function SortHeader({ sort, view, t }: { sort: ApplicationSort; view: ApplicationListView; t: T }) {
  const current = view.sort === sort;
  const order = current && view.order === "asc" ? "desc" : "asc";
  return (
    <th scope="col" aria-sort={current ? (view.order === "asc" ? "ascending" : "descending") : undefined}>
      <Link className="sort-link" href={applicationListHref(routes.applications, view, { sort, order })}>
        {t(SORT_LABELS[sort])}
        {current ? <span className="visually-hidden">, {t(view.order === "asc" ? "applications.sortedAscending" : "applications.sortedDescending")}</span> : null}
        <span className="sort-mark" aria-hidden="true">
          {current ? SORT_MARKS[view.order] : UNSORTED_MARK}
        </span>
      </Link>
    </th>
  );
}

function List({ applications, view, t, formatDate }: { applications: ApplicationSummary[]; view: ApplicationListView; t: T; formatDate: (value: Date) => string }) {
  return (
    <div className="table-scroll">
      <table className="application-table">
        <thead>
          <tr>
            {APPLICATION_SORTS.map((sort) => (
              <SortHeader key={sort} sort={sort} view={view} t={t} />
            ))}
          </tr>
        </thead>
        <tbody>
          {applications.map((application) => (
            <tr key={application.id}>
              <th scope="row">
                <Link href={routes.application(application.id)}>{jobOfferLabel(application)}</Link>
                <ExpiredFlag application={application} t={t} />
              </th>
              <td>{application.profile.name}</td>
              <td>
                {application.interviews.length > 0
                  ? application.interviews.map((interview) => formatDate(interview.scheduledAt)).join(", ")
                  : t("applications.noInterview")}
              </td>
              <td>
                <ApplicationStatusSelect applicationId={application.id} status={application.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Board({ applications, t }: { applications: ApplicationSummary[]; t: T }) {
  return (
    <div className="board">
      {APPLICATION_STATUSES.map((status) => {
        const inColumn = applications.filter((application) => application.status === status);
        return (
          <section key={status} className="board-column" aria-labelledby={`column-${status}`}>
            <h2 id={`column-${status}`}>{t(`applicationStatuses.${status}`)}</h2>
            {inColumn.length === 0 ? (
              <p className="hint">{t("applications.emptyColumn")}</p>
            ) : (
              <ul className="board-cards">
                {inColumn.map((application) => (
                  <li key={application.id} className="board-card">
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
