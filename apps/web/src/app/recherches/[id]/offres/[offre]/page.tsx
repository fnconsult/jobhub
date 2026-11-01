import { notFound, redirect } from "next/navigation";
import { JobOfferInPane } from "@/components/JobOfferInPane";
import { pagesAreConversations } from "@/components/ObjectConversation";
import { InWorkPane } from "@/components/WorkPane";
import { routes } from "@/routes";
import { loadJobSearchPage } from "../../job-search-page";

type Params = { params: Promise<{ id: string; offre: string }> };

/**
 * One Job Offer a Job Search found, one of its Results (#605): in the Work Pane beside its conversation, its Match Score
 * against the searched Profile and saving it as an Application. 404 for a Job Offer it did not find. Without
 * « Conversation au centre », the Job Offer's own page.
 */
export default async function JobSearchOfferPage({ params }: Params) {
  const { id, offre } = await params;
  const { jobSearch, t, locale } = await loadJobSearchPage(id);
  const result = jobSearch.results.find((found) => found.jobOffer.id === offre);
  if (!result) notFound();
  if (!pagesAreConversations()) redirect(routes.jobOffer(result.jobOffer.id, jobSearch.profile.id));
  return (
    <InWorkPane kind="result" title={result.jobOffer.title} href={routes.jobSearchOffer(jobSearch.id, result.jobOffer.id)} back={routes.jobSearch(jobSearch.id)}>
      <JobOfferInPane result={result} profile={jobSearch.profile} t={t} locale={locale} />
    </InWorkPane>
  );
}
