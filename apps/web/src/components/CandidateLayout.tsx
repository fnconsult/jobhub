import type { ReactNode } from "react";
import type { ActivityElement } from "@/ai-activity/pane";
import { currentIsAdministrator } from "@/admin/server";
import { getBilling, getPaymentFailedNotice } from "@/billing/server";
import { usageMeter, type UsageMeter } from "@/billing/usage-meter";
import { JobSearchNotifications } from "@/components/JobSearchNotifications";
import { PaymentFailedBanner } from "@/components/PaymentFailedNotice";
import { SidebarLayout } from "@/components/SidebarLayout";
import { getRequestLocale } from "@/i18n/server";
import { currentHumanCoach } from "@/human-coaches/server";
import { getJobSearches } from "@/job-searches/server";
import { getProfiles } from "@/profiles/server";

/** The sidebar's Usage Meter; never fails the page: without billing, there is no meter. */
async function weekUsage(candidateId: string): Promise<UsageMeter | null> {
  try {
    const { quotas, usedThisWeek } = await getBilling().entitlements(candidateId);
    return usageMeter(quotas, usedThisWeek);
  } catch (error) {
    console.error("[billing] could not read the week's usage", error);
    return null;
  }
}

/**
 * The frame of every signed-in Candidate's page: the sidebar layout (see
 * SidebarLayout) around `children`, which it renders as the page's `<main>`,
 * topped by the Payment Failed Notice while there is one, and the
 * notifications of the Candidate's finished Job Searches. `currentProfileId`
 * is the Profile in view (or the one a Job Search or Job Digest belongs to):
 * the Profile switcher names it and the sidebar's Profile links lead to it.
 * `title` is the page's `<h1>`, shown in the Top Bar (see SidebarShell).
 * `wide` gives the page room for a board. `aiActivity`: the page's elements for
 * AI Activity's pane, from its page type's loader (ai-activity/server); none on a
 * page with no AI content.
 */
export async function CandidateLayout({
  candidateId,
  currentProfileId,
  title,
  wide,
  aiActivity,
  children,
}: {
  candidateId: string;
  currentProfileId?: string;
  title?: ReactNode;
  wide?: boolean;
  aiActivity?: readonly ActivityElement[];
  children: ReactNode;
}) {
  const [profiles, canAddProfile, paymentFailed, jobSearchNotifications, humanCoach, isAdministrator, usage] = await Promise.all([
    getProfiles().list(candidateId),
    getProfiles().canAddProfile(candidateId),
    getRequestLocale().then((locale) => getPaymentFailedNotice(candidateId, locale)),
    getJobSearches().notifications(candidateId),
    currentHumanCoach(),
    currentIsAdministrator(),
    weekUsage(candidateId),
  ]);
  return (
    <SidebarLayout
      profiles={profiles.map(({ id, name, archived }) => ({ id, name, archived }))}
      currentProfileId={currentProfileId}
      canAddProfile={canAddProfile}
      isHumanCoach={Boolean(humanCoach)}
      isAdministrator={isAdministrator}
      usage={usage}
      title={title}
      wide={wide}
      aiActivity={aiActivity}
    >
      {paymentFailed ? <PaymentFailedBanner notice={paymentFailed} /> : null}
      {jobSearchNotifications ? <JobSearchNotifications initial={jobSearchNotifications} /> : null}
      {children}
    </SidebarLayout>
  );
}
