import Link from "next/link";
import { getCurrentCandidate } from "@/auth/server";
import { CandidateLayout } from "@/components/CandidateLayout";
import { FreeConversationPage } from "@/components/FreeConversationPage";
import { routes } from "@/routes";
import { TextSizeControl } from "@/components/TextSizeControl";
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
 * The home page: for a signed-in Candidate, in the sidebar layout like every page of theirs (ADR-0024), a new Free
 * conversation, the page itself (#601, ADR-0070), the quick actions its suggestions (#467).
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
  if (candidate)
    return (
      <CandidateLayout candidateId={candidate.id} title={t("conversationFirst.newConversation")}>
        <FreeConversationPage conversationId={null} />
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
