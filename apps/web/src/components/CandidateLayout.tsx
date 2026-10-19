import type { ReactNode } from "react";
import { currentIsAdministrator } from "@/admin/server";
import { getPaymentFailedNotice } from "@/billing/server";
import { JobSearchNotifications } from "@/components/JobSearchNotifications";
import { PaymentFailedBanner } from "@/components/PaymentFailedNotice";
import { SidebarLayout } from "@/components/SidebarLayout";
import { getRequestLocale } from "@/i18n/server";
import { currentHumanCoach } from "@/human-coaches/server";
import { getJobSearches } from "@/job-searches/server";
import { getProfiles } from "@/profiles/server";

/**
 * The frame of every signed-in Candidate's page: the sidebar layout (see
 * SidebarLayout) around `children`, which it renders as the page's `<main>`,
 * topped by the Payment Failed Notice while there is one, and the
 * notifications of the Candidate's finished Job Searches. `currentProfileId`
 * is the Profile in view (or the one a Job Search or Job Digest belongs to):
 * the Profile switcher names it and the sidebar's Profile links lead to it.
 * `title` is the page's `<h1>`, shown in the Top Bar (see SidebarShell).
 * `wide` gives the page room for a board.
 */
export async function CandidateLayout({
  candidateId,
  currentProfileId,
  title,
  wide,
  children,
}: {
  candidateId: string;
  currentProfileId?: string;
  title?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  const [profiles, canAddProfile, paymentFailed, jobSearchNotifications, humanCoach, isAdministrator] = await Promise.all([
    getProfiles().list(candidateId),
    getProfiles().canAddProfile(candidateId),
    getRequestLocale().then((locale) => getPaymentFailedNotice(candidateId, locale)),
    getJobSearches().notifications(candidateId),
    currentHumanCoach(),
    currentIsAdministrator(),
  ]);
  return (
    <SidebarLayout
      profiles={profiles.map(({ id, name, archived }) => ({ id, name, archived }))}
      currentProfileId={currentProfileId}
      canAddProfile={canAddProfile}
      isHumanCoach={Boolean(humanCoach)}
      isAdministrator={isAdministrator}
      title={title}
      wide={wide}
    >
      {paymentFailed ? <PaymentFailedBanner notice={paymentFailed} /> : null}
      {jobSearchNotifications ? <JobSearchNotifications initial={jobSearchNotifications} /> : null}
      {children}
    </SidebarLayout>
  );
}
