import { redirect } from "next/navigation";
import { JobOfferResults } from "@/components/JobOfferResults";
import { pagesAreConversations } from "@/components/ObjectConversation";
import { InWorkPane } from "@/components/WorkPane";
import { routes } from "@/routes";
import { loadJobSearchPage, type Params } from "../job-search-page";

/**
 * The Job Offers a Job Search found, best Match Score first, each saved as an Application in one click (#605): its
 * Section, in the Work Pane beside its conversation, each Job Offer opening there in its place. Without « Conversation
 * au centre », the Job Search's page lists them.
 */
export default async function JobSearchOffersPage({ params }: Params) {
  const { jobSearch, t, locale } = await loadJobSearchPage((await params).id);
  if (!pagesAreConversations()) redirect(routes.jobSearch(jobSearch.id));
  const { profile, results } = jobSearch;
  return (
    <InWorkPane kind="section" title={t("jobSearch.resultsLabel")} href={routes.jobSearchSection(jobSearch.id, "offres")} back={routes.jobSearch(jobSearch.id)}>
      {results.length > 0 ? (
        <JobOfferResults results={results} profileId={profile.id} t={t} locale={locale} headingLevel={3} offerHref={(jobOfferId) => routes.jobSearchOffer(jobSearch.id, jobOfferId)} />
      ) : (
        <p className="notice">{t(jobSearch.status === "searching" ? "jobSearch.searching" : "jobSearch.noResults")}</p>
      )}
    </InWorkPane>
  );
}
