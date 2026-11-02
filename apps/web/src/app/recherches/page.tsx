import type { Metadata } from "next";
import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { CandidateLayout } from "@/components/CandidateLayout";
import { JobSearchesMenuPage } from "@/components/JobSearchesMenuPage";
import { getServerT } from "@/i18n/server";
import "./recherches.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("sidebar.jobSearches")} · ${t("app.name")}` };
}

/**
 * Recherches d'offres (#606, ADR-0070): the menu's conversation is the page, the Job Searches by Profile a card in its
 * thread (see JobSearchesMenuPage); « recues=1 » in the address opens « Reçues par email » (#447) in the Work Pane.
 */
export default async function JobSearchesPage({ searchParams }: { searchParams: Promise<{ recues?: string }> }) {
  const candidate = await getCurrentCandidate();
  if (!candidate) return signInRedirect();
  const [t, params] = await Promise.all([getServerT(), searchParams]);
  return (
    <CandidateLayout candidateId={candidate.id} title={t("sidebar.jobSearches")}>
      <JobSearchesMenuPage candidateId={candidate.id} received={params.recues !== undefined} />
    </CandidateLayout>
  );
}
