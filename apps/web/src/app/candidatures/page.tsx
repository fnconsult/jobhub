import type { Metadata } from "next";
import { applicationListView, type ApplicationListParams } from "@/applications/list-view";
import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { ApplicationsMenuPage } from "@/components/ApplicationsMenuPage";
import { CandidateLayout } from "@/components/CandidateLayout";
import { getServerT } from "@/i18n/server";
import "./candidatures.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("applications.title")} · ${t("app.name")}` };
}

/**
 * Mes candidatures (#604, ADR-0070): the menu's conversation is the page, the Candidate's Applications a card in its
 * thread (see ApplicationsMenuPage); « archivees=1 » in the address shows the Archived Applications too.
 */
export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<ApplicationListParams> }) {
  const candidate = await getCurrentCandidate();
  if (!candidate) return signInRedirect();
  const [t, params] = await Promise.all([getServerT(), searchParams]);
  return (
    <CandidateLayout candidateId={candidate.id} title={t("applications.title")}>
      <ApplicationsMenuPage candidateId={candidate.id} showArchived={applicationListView(params).showArchived} />
    </CandidateLayout>
  );
}
