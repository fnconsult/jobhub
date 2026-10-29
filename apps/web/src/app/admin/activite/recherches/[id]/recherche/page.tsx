import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireBackOffice } from "@/admin/server";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { Card } from "@/design/Card";
import { Note } from "@/design/Note";
import { Properties, Property } from "@/design/Properties";
import { Table } from "@/design/Table";
import type { DiscoveryRunPeriod } from "@/discovery-runs";
import { getDiscoveryRuns } from "@/discovery-runs/server";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { getJobSearches } from "@/job-searches/server";
import { routes } from "@/routes";
import "../../../../section.css";

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
      <div className="section-page">
        <p>
          <Link prefetch={false} href={routes.adminDiscoveryRuns({ period: ANY_PERIOD, run: id })}>
            {t("admin.discoveryRuns.jobSearch.back")}
          </Link>
        </p>
        <Note role="status">{t("admin.discoveryRuns.jobSearch.audited")}</Note>
        <Card>
          <Properties label={t("admin.discoveryRuns.jobSearch.title")}>
            <Property term={t("admin.discoveryRuns.jobSearch.startedAt")}>
              <time dateTime={jobSearch.startedAt.toISOString()}>{at.format(jobSearch.startedAt)}</time>
            </Property>
            <Property term={t("admin.discoveryRuns.jobSearch.status")}>{t(`admin.discoveryRuns.jobSearch.statuses.${jobSearch.status}`)}</Property>
            <Property term={t("admin.discoveryRuns.jobSearch.criteria")}>{[jobSearch.profile.searchCriteria.targetRole, ...jobSearch.profile.searchCriteria.locations].join(" · ")}</Property>
          </Properties>
        </Card>
        <section className="section-block" aria-labelledby="job-search-results">
          <h2 id="job-search-results">{t("admin.discoveryRuns.jobSearch.results", { count: jobSearch.results.length })}</h2>
          {jobSearch.results.length === 0 ? (
            <p>{t("admin.discoveryRuns.jobSearch.noResult")}</p>
          ) : (
            <Table
              label={t("admin.discoveryRuns.jobSearch.results", { count: jobSearch.results.length })}
              columns={[
                {
                  header: t("admin.discoveryRuns.jobSearch.offer"),
                  rowHeader: true,
                  cell: ({ jobOffer }) =>
                    jobOffer.source.url ? (
                      <a href={jobOffer.source.url} rel="noreferrer noopener" target="_blank">
                        {jobOffer.title}
                      </a>
                    ) : (
                      jobOffer.title
                    ),
                },
                { header: t("admin.discoveryRuns.jobSearch.employer"), cell: ({ jobOffer }) => jobOffer.employer ?? "—" },
                { header: t("admin.discoveryRuns.jobSearch.location"), cell: ({ jobOffer }) => jobOffer.location ?? "—" },
                { header: t("admin.discoveryRuns.jobSearch.matchScore"), numeric: true, cell: ({ matchScore }) => matchScore.score },
              ]}
              rows={jobSearch.results}
              rowKey={({ jobOffer }) => jobOffer.id}
            />
          )}
        </section>
      </div>
    </BackOfficeLayout>
  );
}
