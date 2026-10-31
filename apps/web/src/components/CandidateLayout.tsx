import type { ReactNode } from "react";
import type { ActivityElement } from "@/ai-activity/pane";
import { currentIsAdministrator } from "@/admin/server";
import { getBilling, getPaymentFailedNotice } from "@/billing/server";
import { usageMeter, type UsageMeter } from "@/billing/usage-meter";
import { JobSearchNotifications } from "@/components/JobSearchNotifications";
import { PaymentFailedBanner } from "@/components/PaymentFailedNotice";
import { SignalementNotifications } from "@/components/SignalementNotifications";
import { SidebarLayout } from "@/components/SidebarLayout";
import { getCoachConversations } from "@/coach-conversations/server";
import { conversationFirst } from "@/conversation-first";
import { getRequestLocale } from "@/i18n/server";
import { currentHumanCoach } from "@/human-coaches/server";
import { getJobSearches } from "@/job-searches/server";
import { PrivacyChangeNotice } from "@/components/PrivacyChangeNotice";
import { getLegalTextNotices } from "@/legal-text-notices/server";
import { getPlatformSettingsResolver } from "@/platform-settings/server";
import { getProfiles } from "@/profiles/server";
import { getSignalements, jobbboxVersion } from "@/signalements/server";

/** The privacy policy's change to show the Candidate once (#547); never fails the page: without it, there is none. */
async function privacyChange(candidateId: string) {
  try {
    return await getLegalTextNotices().privacyChange(candidateId);
  } catch (error) {
    console.error("[legal-text-notices] could not read the privacy policy's change", error);
    return null;
  }
}

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
 * The Candidate's Free conversations for the Sidebar, most recently active first, while « Conversation au centre » is on
 * (#601, ADR-0070); null while it is off. Never fails the page: without them, the Sidebar lists none.
 */
async function freeConversations(candidateId: string): Promise<{ id: string; title: string }[] | null> {
  if (!conversationFirst(getPlatformSettingsResolver().current())) return null;
  try {
    const conversations = await getCoachConversations().list(candidateId);
    return conversations.filter((conversation) => conversation.subject === null).map(({ id, title }) => ({ id, title }));
  } catch (error) {
    console.error("[coach-conversations] could not list the Free conversations", error);
    return [];
  }
}

/**
 * The frame of every signed-in Candidate's page: the sidebar layout (see
 * SidebarLayout) around `children`, which it renders as the page's `<main>`,
 * topped by the Payment Failed Notice while there is one, the privacy policy's change until closed (#547), the
 * notifications of the Candidate's finished Job Searches and those of their
 * Signalements the team replied to or marked « traité » (#377). `currentProfileId`
 * is the Profile in view (or the one a Job Search or Job Digest belongs to):
 * the Profile switcher names it and the sidebar's Profile links lead to it.
 * `title` is the page's `<h1>`, shown in the Top Bar (see SidebarShell).
 * `wide` gives the page room for a board. `aiActivity`: the page's elements for
 * AI Activity's pane, from its page type's loader (ai-activity/server); none on a
 * page with no AI content. Under « Conversation au centre » (#601), the Sidebar lists the Free conversations.
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
  const [profiles, canAddProfile, paymentFailed, jobSearchNotifications, signalementNotifications, humanCoach, isAdministrator, usage, privacy, free] = await Promise.all([
    getProfiles().list(candidateId),
    getProfiles().canAddProfile(candidateId),
    getRequestLocale().then((locale) => getPaymentFailedNotice(candidateId, locale)),
    getJobSearches().notifications(candidateId),
    getSignalements().notifications(candidateId),
    currentHumanCoach(),
    currentIsAdministrator(),
    weekUsage(candidateId),
    privacyChange(candidateId),
    freeConversations(candidateId),
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
      version={jobbboxVersion()}
      freeConversations={free}
    >
      {paymentFailed ? <PaymentFailedBanner notice={paymentFailed} /> : null}
      {privacy ? <PrivacyChangeNotice change={privacy} /> : null}
      {jobSearchNotifications ? <JobSearchNotifications initial={jobSearchNotifications} /> : null}
      <SignalementNotifications initial={signalementNotifications} />
      {children}
    </SidebarLayout>
  );
}
