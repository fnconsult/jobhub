import type { Metadata } from "next";
import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { CandidateLayout } from "@/components/CandidateLayout";
import { JobDigestsMenuPage } from "@/components/JobDigestsMenuPage";
import { getServerT } from "@/i18n/server";

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
  const t = await getServerT();
  return (
    <CandidateLayout candidateId={candidate.id} title={t("sidebar.jobDigests")}>
      <JobDigestsMenuPage candidateId={candidate.id} />
    </CandidateLayout>
  );
}
