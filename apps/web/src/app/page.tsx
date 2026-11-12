import { getCurrentCandidate } from "@/auth/server";
import { CandidateLayout } from "@/components/CandidateLayout";
import { FreeConversationPage } from "@/components/FreeConversationPage";
import { Landing } from "@/components/Landing";
import { PublicSite } from "@/design/PublicSite";
import { readHumanCoachPath, readLandingPlans, readLandingStoreLinks } from "@/landing/server";
import { routes } from "@/routes";
import type { Metadata } from "next";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { publicMetadata } from "@/public-pages/indexing-server";

/**
 * The home page is indexed, in French at `/` and in English at `/en` (#545). Its title and description are the landing
 * page's (ADR-0105): what a search engine and a shared link show of Jobbbox.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  const title = t("landing.meta.title");
  const description = t("landing.meta.description");
  return { ...(await publicMetadata(routes.home, ["fr", "en"])), title, description, openGraph: { type: "website", siteName: t("app.name"), title, description } };
}

/**
 * The home page: for a signed-in Candidate, in the sidebar layout like every page of theirs (ADR-0024), a new Free
 * conversation, the page itself (#601, ADR-0070), the quick actions its suggestions (#467). For a Visitor, the landing
 * page in the public shell (ADR-0105), its Plans and store links as the Back Office sets them.
 */
export default async function HomePage() {
  const t = await getServerT();
  const candidate = await getCurrentCandidate();
  if (candidate)
    return (
      <CandidateLayout candidateId={candidate.id} title={t("conversationFirst.newConversation")}>
        <FreeConversationPage conversationId={null} />
      </CandidateLayout>
    );
  return (
    <PublicSite>
      <Landing plans={await readLandingPlans(await getRequestLocale())} stores={readLandingStoreLinks()} coachPath={readHumanCoachPath()} />
    </PublicSite>
  );
}
