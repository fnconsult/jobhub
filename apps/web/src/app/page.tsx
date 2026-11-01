import Link from "next/link";
import { getCurrentCandidate } from "@/auth/server";
import { CandidateLayout } from "@/components/CandidateLayout";
import { FreeConversationPage } from "@/components/FreeConversationPage";
import { conversationFirst } from "@/conversation-first";
import { getPlatformSettingsResolver } from "@/platform-settings/server";
import { routes } from "@/routes";
import { TextSizeControl } from "@/components/TextSizeControl";
import { QuickActions } from "@/components/QuickActions";
import { buttonClass } from "@/design/button-class";
import { Note } from "@/design/Note";
import type { Metadata } from "next";
import { getServerT } from "@/i18n/server";
import { publicMetadata } from "@/public-pages/indexing-server";

/** The home page is indexed, in French at `/` and in English at `/en` (#545). */
export async function generateMetadata(): Promise<Metadata> {
  return publicMetadata(routes.home, ["fr", "en"]);
}

/**
 * The home page: in the sidebar layout for a signed-in Candidate, like every page of theirs (ADR-0024), the quick
 * actions first (#467). Under « Conversation au centre » (#601, ADR-0070), a new Free conversation: the page itself.
 */
export default async function HomePage() {
  const t = await getServerT();
  const candidate = await getCurrentCandidate();
  const intro = (
    <>
      <p className="lead">{t("app.tagline")}</p>
      <p>{t("home.intro")}</p>
      <Note>{t("home.comingSoon")}</Note>
    </>
  );
  if (candidate && conversationFirst(getPlatformSettingsResolver().current()))
    return (
      <CandidateLayout candidateId={candidate.id} title={t("conversationFirst.newConversation")}>
        <FreeConversationPage conversationId={null} />
      </CandidateLayout>
    );
  if (candidate)
    return (
      <CandidateLayout candidateId={candidate.id} title={t("home.title")}>
        <QuickActions />
        {intro}
      </CandidateLayout>
    );
  return (
    <main className="page">
      <header className="page-header">
        <span className="brand">{t("app.name")}</span>
        <nav className="page-nav">
          <TextSizeControl />
          <Link className={buttonClass()} href={routes.signIn}>
            {t("nav.signIn")}
          </Link>
        </nav>
      </header>
      <h1>{t("home.title")}</h1>
      {intro}
    </main>
  );
}
