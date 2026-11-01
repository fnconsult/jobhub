import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { CandidateLayout } from "@/components/CandidateLayout";
import { EmptyStateHelp } from "@/components/HelpTerm";
import { JobDigestSettings } from "@/components/JobDigestSettings";
import { JobDigestsMenuPage } from "@/components/JobDigestsMenuPage";
import { conversationFirst } from "@/conversation-first";
import { getPlatformSettingsResolver } from "@/platform-settings/server";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { getJobDigests } from "@/job-digests/server";
import { getProfiles } from "@/profiles/server";
import { routes } from "@/routes";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("sidebar.jobDigests")} · ${t("app.name")}` };
}

/**
 * The Job Digests: for every active Profile, its Job Digest (how often, and the
 * latest ones sent). A page of its own, from the sidebar, apart from the Profile's
 * page (ADR-0024); an archived Profile has none.
 * Under « Conversation au centre » (#606, ADR-0070), the menu's conversation is the page instead, the Job Digests by
 * Profile a card in its thread (see JobDigestsMenuPage).
 */
export default async function JobDigestsPage() {
  const candidate = await getCurrentCandidate();
  if (!candidate) return signInRedirect();
  if (conversationFirst(getPlatformSettingsResolver().current())) {
    const t = await getServerT();
    return (
      <CandidateLayout candidateId={candidate.id} title={t("sidebar.jobDigests")}>
        <JobDigestsMenuPage candidateId={candidate.id} />
      </CandidateLayout>
    );
  }
  const [t, locale, profiles] = await Promise.all([getServerT(), getRequestLocale(), getProfiles().list(candidate.id)]);
  const active = profiles.filter((profile) => !profile.archived);
  const digests = await Promise.all(active.map(async (profile) => ({ profile, jobDigest: await getJobDigests().settings(candidate.id, profile.id) })));
  return (
    <CandidateLayout candidateId={candidate.id} title={t("sidebar.jobDigests")}>
      <p className="lead">{t("jobDigest.hint")}</p>
      {active.length === 0 ? (
        <p className="notice">
          {t("profiles.none")} <Link href={routes.newProfile}>{t("profiles.create")}</Link> <EmptyStateHelp of="profiles" />
        </p>
      ) : (
        digests.map(({ profile, jobDigest }) => (jobDigest ? <JobDigestSettings key={profile.id} profile={profile} jobDigest={jobDigest} locale={locale} t={t} /> : null))
      )}
    </CandidateLayout>
  );
}
