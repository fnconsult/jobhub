import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireBackOffice } from "@/admin/server";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import type { DiscoveryRunPeriod } from "@/discovery-runs";
import { getDiscoveryRuns } from "@/discovery-runs/server";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { getJobSearches } from "@/job-searches/server";
import { routes } from "@/routes";

type Params = { params: Promise<{ id: string }> };

/** The run is listed whatever its age: back to it. */
const ANY_PERIOD: DiscoveryRunPeriod = "all";

export async function generateMetadata(): Promise<Metadata> {
  // Not the Job Search itself: opening it here would write a second view to the Back Office Audit.
  await requireBackOffice("jobSearches");
  const t = await getServerT();
  return { title: `${t("admin.discoveryRuns.jobSearch.title")} · ${t("admin.activity.title")} · ${t("admin.title")}`, robots: { index: false } };
}

/**
 * The Job Search behind a run of Activité › Recherches (#404): super-admins only, while the run keeps its link (30 days),
 * each opening written to the Back Office Audit as it is read. What the Candidate's own page shows: its status and the
 * Job Offers it found, best Match Score first.
 */
export default async function RunJobSearchPage({ params }: Params) {
  const { access, administrator } = await requireBackOffice("jobSearches");
  const { id } = await params;
  const opened = await getDiscoveryRuns().openJobSearch(administrator, id);
  const jobSearch = opened ? await getJobSearches().get(opened.candidateId, opened.jobSearchId) : null;
  if (!jobSearch) notFound();
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const at = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" });

  return (
    <BackOfficeLayout access={access} title={t("admin.discoveryRuns.jobSearch.title")}>
      <p>
        <Link prefetch={false} href={routes.adminDiscoveryRuns({ period: ANY_PERIOD, run: id })}>
          {t("admin.discoveryRuns.jobSearch.back")}
        </Link>
      </p>
      <p className="notice" role="status">
        {t("admin.discoveryRuns.jobSearch.audited")}
      </p>
      <dl className="props" aria-label={t("admin.discoveryRuns.jobSearch.title")}>
        <dt>{t("admin.discoveryRuns.jobSearch.startedAt")}</dt>
        <dd>
          <time dateTime={jobSearch.startedAt.toISOString()}>{at.format(jobSearch.startedAt)}</time>
        </dd>
        <dt>{t("admin.discoveryRuns.jobSearch.status")}</dt>
        <dd>{t(`admin.discoveryRuns.jobSearch.statuses.${jobSearch.status}`)}</dd>
        <dt>{t("admin.discoveryRuns.jobSearch.criteria")}</dt>
        <dd>{[jobSearch.profile.searchCriteria.targetRole, ...jobSearch.profile.searchCriteria.locations].join(" · ")}</dd>
      </dl>
      <h2>{t("admin.discoveryRuns.jobSearch.results", { count: jobSearch.results.length })}</h2>
      {jobSearch.results.length === 0 ? (
        <p>{t("admin.discoveryRuns.jobSearch.noResult")}</p>
      ) : (
        <div className="table-scroll">
          <table className="application-table">
            <thead>
              <tr>
                <th scope="col">{t("admin.discoveryRuns.jobSearch.offer")}</th>
                <th scope="col">{t("admin.discoveryRuns.jobSearch.employer")}</th>
                <th scope="col">{t("admin.discoveryRuns.jobSearch.location")}</th>
                <th scope="col">{t("admin.discoveryRuns.jobSearch.matchScore")}</th>
              </tr>
            </thead>
            <tbody>
              {jobSearch.results.map(({ jobOffer, matchScore }) => (
                <tr key={jobOffer.id}>
                  <th scope="row">
                    {jobOffer.source.url ? (
                      <a href={jobOffer.source.url} rel="noreferrer noopener" target="_blank">
                        {jobOffer.title}
                      </a>
                    ) : (
                      jobOffer.title
                    )}
                  </th>
                  <td>{jobOffer.employer ?? "—"}</td>
                  <td>{jobOffer.location ?? "—"}</td>
                  <td>{matchScore.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </BackOfficeLayout>
  );
}
