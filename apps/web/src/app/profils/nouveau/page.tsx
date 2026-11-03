import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { CandidateLayout } from "@/components/CandidateLayout";
import { ProfileOnboarding } from "@/components/ProfileOnboarding";
import { UpgradePrompt } from "@/components/UpgradePrompt";
import { getServerT } from "@/i18n/server";
import { profileUpgradePromptFor } from "@/profiles/server";
import { routes } from "@/routes";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("newProfile.title")} · ${t("app.name")}` };
}

/**
 * Creating a Profile from an uploaded CV, the Onboarding Questionnaire or from scratch (no LinkedIn import of any kind,
 * ADR-0001), the page a conversation with the AI Coach (ADR-0070, see ProfileOnboarding). When the Plan allows no more
 * Profiles, the conversation's card is the Upgrade prompt.
 */
export default async function NewProfilePage() {
  const candidate = await getCurrentCandidate();
  if (!candidate) return signInRedirect();
  const t = await getServerT();
  const upgradePrompt = await profileUpgradePromptFor(candidate);
  return (
    <CandidateLayout candidateId={candidate.id} title={t("newProfile.title")}>
      {upgradePrompt ? (
        <section className="page-conversation" aria-label={t("newProfile.conversation")}>
          <div className="page-conversation-thread">
            <ol className="chat" aria-label={t("questionnaire.transcript")}>
              <li className="chat-message chat-card">
                <UpgradePrompt prompt={upgradePrompt} />
                <p>
                  <Link href={routes.account}>{t("profile.backToAccount")}</Link>
                </p>
              </li>
            </ol>
          </div>
        </section>
      ) : (
        <ProfileOnboarding />
      )}
    </CandidateLayout>
  );
}
