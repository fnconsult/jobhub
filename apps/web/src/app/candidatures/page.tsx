import { APPLICATION_STATUSES } from "@jobhub/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { INTERVIEW_TIME_ZONE, type ApplicationSummary } from "@/applications";
import { getApplications } from "@/applications/server";
import { getCurrentCandidate } from "@/auth/server";
import { ApplicationStatusSelect } from "@/components/ApplicationControls";
import { WorkspaceHeader } from "@/components/WorkspaceHeader";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";

/** `aria-current` of the link to the view being shown. */
const CURRENT = "page";

type T = Awaited<ReturnType<typeof getServerT>>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("applications.title")} · ${t("app.name")}` };
}

/** The Candidate's Applications, as a list (by default) or as a board with one column per Application Status. */
export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<{ vue?: string }> }) {
  const candidate = await getCurrentCandidate();
  if (!candidate) redirect(routes.signIn);
  const [t, locale, applications, { vue }] = await Promise.all([getServerT(), getRequestLocale(), getApplications().list(candidate.id), searchParams]);
  const board = vue === "tableau";
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: INTERVIEW_TIME_ZONE });
  return (
    <main className={board ? "page page-wide" : "page"}>
      <WorkspaceHeader candidateId={candidate.id} />
      <h1>{t("applications.title")}</h1>
      <nav className="actions" aria-label={t("applications.viewsLabel")}>
        <Link className="button" href={routes.applications} aria-current={board ? undefined : CURRENT}>
          {t("applications.listView")}
        </Link>
        <Link className="button" href={routes.applicationsBoard} aria-current={board ? CURRENT : undefined}>
          {t("applications.boardView")}
        </Link>
      </nav>
      {applications.length === 0 ? (
        <p className="notice">{t("applications.none")}</p>
      ) : board ? (
        <Board applications={applications} t={t} />
      ) : (
        <List applications={applications} t={t} formatDate={(value) => date.format(value)} />
      )}
    </main>
  );
}

const jobOfferLabel = (application: ApplicationSummary) =>
  [application.jobOffer.title, application.jobOffer.employer, application.jobOffer.location].filter(Boolean).join(" · ");

/** Flags an Application on an Expired Job Offer, in words (its status is left as the Candidate set it). */
function ExpiredFlag({ application, t }: { application: ApplicationSummary; t: T }) {
  return application.jobOffer.expiredAt ? <span className="expired-flag">{t("applications.expired")}</span> : null;
}

function List({ applications, t, formatDate }: { applications: ApplicationSummary[]; t: T; formatDate: (value: Date) => string }) {
  return (
    <div className="table-scroll">
      <table className="application-table">
        <thead>
          <tr>
            <th scope="col">{t("applications.jobOffer")}</th>
            <th scope="col">{t("applications.profile")}</th>
            <th scope="col">{t("applications.interviews")}</th>
            <th scope="col">{t("applications.status")}</th>
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
