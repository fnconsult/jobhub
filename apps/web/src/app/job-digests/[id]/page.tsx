import type { Metadata } from "next";
import Link from "next/link";
import { CandidateLayout } from "@/components/CandidateLayout";
import { CoachInView } from "@/components/CoachPanel";
import { JobOfferResults } from "@/components/JobOfferResults";
import { pagesAreConversations } from "@/components/ObjectConversation";
import { getServerT } from "@/i18n/server";
import { requireOwnJobDigest } from "@/job-digests/server";
import { routes } from "@/routes";
import { loadJobDigestPage, type Params } from "./job-digest-page";

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const t = await getServerT();
  const { jobDigest } = await requireOwnJobDigest((await params).id);
  return { title: `${t("jobDigest.page.title", { profile: jobDigest.profile.name })} · ${t("app.name")}` };
}

/**
 * One Job Digest, linked from its email and from the Profile page: the Job
 * Offers it brought, best Match Score first (the Job Search results view),
 * each one a click away from becoming an Application with the Profile.
 * Under « Conversation au centre » (#605, ADR-0070), the page is the Job Digest's conversation instead (layout.tsx).
 */
export default async function JobDigestPage({ params }: Params) {
  if (pagesAreConversations()) return null;
  const { candidateId, jobDigest, t, locale, aiActivity, inView } = await loadJobDigestPage((await params).id);
  const { profile, results } = jobDigest;
  const sentAt = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "Europe/Paris" }).format(jobDigest.sentAt);
  return (
    <CandidateLayout candidateId={candidateId} currentProfileId={profile.id} title={t("jobDigest.page.title", { profile: profile.name })} aiActivity={aiActivity}>
      <p>
        <Link href={routes.profile(profile.id)}>{t("jobDigest.page.backToProfile")}</Link>
      </p>
      <p>{t("jobDigest.sentAt", { date: sentAt })}</p>
      <CoachInView {...inView} />
      <p>{t("jobDigest.page.intro", { count: results.length })}</p>
      <JobOfferResults results={results} profileId={profile.id} t={t} locale={locale} />
    </CandidateLayout>
  );
}
