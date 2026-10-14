import type { Metadata } from "next";
import Link from "next/link";
import { CandidateLayout } from "@/components/CandidateLayout";
import { CoachInView } from "@/components/CoachPanel";
import { JobOfferResults } from "@/components/JobOfferResults";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { requireOwnJobDigest } from "@/job-digests/server";
import { routes } from "@/routes";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const t = await getServerT();
  const { jobDigest } = await requireOwnJobDigest((await params).id);
  return { title: `${t("jobDigest.page.title", { profile: jobDigest.profile.name })} · ${t("app.name")}` };
}

/**
 * One Job Digest, linked from its email and from the Profile page: the Job
 * Offers it brought, best Match Score first (the Job Search results view),
 * each one a click away from becoming an Application with the Profile.
 */
export default async function JobDigestPage({ params }: Params) {
  const { candidateId, jobDigest } = await requireOwnJobDigest((await params).id);
  const [t, locale] = await Promise.all([getServerT(), getRequestLocale()]);
  const { profile, results } = jobDigest;
  const inView = { kind: "profile", id: profile.id, name: profile.name } as const;
  const sentAt = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "Europe/Paris" }).format(jobDigest.sentAt);
  return (
    <CandidateLayout candidateId={candidateId} currentProfileId={profile.id}>
      <p>
        <Link href={routes.profile(profile.id)}>{t("jobDigest.page.backToProfile")}</Link>
      </p>
      <h1>{t("jobDigest.page.title", { profile: profile.name })}</h1>
      <p>{t("jobDigest.sentAt", { date: sentAt })}</p>
      <CoachInView {...inView} />
      <p>{t("jobDigest.page.intro", { count: results.length })}</p>
      <JobOfferResults results={results} profileId={profile.id} t={t} locale={locale} />
    </CandidateLayout>
  );
}
