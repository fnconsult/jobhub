import { notFound } from "next/navigation";
import { JobOfferInPane } from "@/components/JobOfferInPane";
import { InWorkPane } from "@/components/WorkPane";
import type { AddressedKind } from "@/components/work-pane";
import { routes } from "@/routes";
import { loadJobDigestPage } from "../../job-digest-page";

/** What it is in the Work Pane. */
const RESULT: AddressedKind = "result";

type Params = { params: Promise<{ id: string; offre: string }> };

/**
 * One Job Offer a Job Digest brought, one of its Results (#605): in the Work Pane beside its conversation, its Match
 * Score against the Profile and saving it as an Application. 404 for a Job Offer it did not bring. Without
 * « Conversation au centre », the Job Offer's own page.
 */
export default async function JobDigestOfferPage({ params }: Params) {
  const { id, offre } = await params;
  const { jobDigest, t, locale } = await loadJobDigestPage(id);
  const result = jobDigest.results.find((found) => found.jobOffer.id === offre);
  if (!result) notFound();
  return (
    <InWorkPane kind={RESULT} title={result.jobOffer.title} href={routes.jobDigestOffer(jobDigest.id, result.jobOffer.id)} back={routes.jobDigest(jobDigest.id)}>
      <JobOfferInPane result={result} profile={jobDigest.profile} t={t} locale={locale} />
    </InWorkPane>
  );
}
