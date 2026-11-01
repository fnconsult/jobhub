import { redirect } from "next/navigation";
import { JobOfferResults } from "@/components/JobOfferResults";
import { pagesAreConversations } from "@/components/ObjectConversation";
import { InWorkPane } from "@/components/WorkPane";
import { routes } from "@/routes";
import { loadJobDigestPage, type Params } from "../job-digest-page";

/**
 * The Job Offers a Job Digest brought, best Match Score first, each saved as an Application in one click (#605): its
 * Section, in the Work Pane beside its conversation, each Job Offer opening there in its place. Without « Conversation
 * au centre », the Job Digest's page lists them.
 */
export default async function JobDigestOffersPage({ params }: Params) {
  const { jobDigest, t, locale } = await loadJobDigestPage((await params).id);
  if (!pagesAreConversations()) redirect(routes.jobDigest(jobDigest.id));
  const { profile, results } = jobDigest;
  return (
    <InWorkPane kind="section" title={t("jobSearch.resultsLabel")} href={routes.jobDigestSection(jobDigest.id, "offres")} back={routes.jobDigest(jobDigest.id)}>
      <p>{t("jobDigest.page.intro", { count: results.length })}</p>
      <JobOfferResults results={results} profileId={profile.id} t={t} locale={locale} headingLevel={3} offerHref={(jobOfferId) => routes.jobDigestOffer(jobDigest.id, jobOfferId)} />
    </InWorkPane>
  );
}
