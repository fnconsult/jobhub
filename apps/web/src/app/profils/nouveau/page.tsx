import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { CandidateLayout } from "@/components/CandidateLayout";
import { OnboardingWelcome, ProfileOnboarding, type ResumedProfile } from "@/components/ProfileOnboarding";
import { UpgradePrompt } from "@/components/UpgradePrompt";
import { getServerT } from "@/i18n/server";
import { getProfiles, profileUpgradePromptFor } from "@/profiles/server";
import { routes } from "@/routes";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("newProfile.title")} · ${t("app.name")}` };
}

/**
 * Creating a Profile from an uploaded CV, the Onboarding Questionnaire or from scratch (no LinkedIn import of any kind,
 * ADR-0001), the page a conversation with the AI Coach (ADR-0070, see ProfileOnboarding). When the Plan allows no more
 * Profiles, the conversation's card is the Upgrade prompt, after the same welcome panel (#997). With `?profil=<id>`, a
 * Profile of the Candidate born during its onboarding and not finished (ADR-0106, #999) resumes at its review: it counts
 * in the Plan Quota already. Any other Profile of theirs opens its own page.
 */
export default async function NewProfilePage({ searchParams }: { searchParams: Promise<{ profil?: string | string[] }> }) {
  const candidate = await getCurrentCandidate();
  if (!candidate) return signInRedirect();
  const [t, { profil }] = await Promise.all([getServerT(), searchParams]);
  const resumed = typeof profil === "string" ? await resumedProfile(candidate.id, profil) : null;
  const upgradePrompt = resumed ? null : await profileUpgradePromptFor(candidate);
  return (
    <CandidateLayout candidateId={candidate.id} title={t("newProfile.title")}>
      {upgradePrompt ? (
        <section className="page-conversation" aria-label={t("newProfile.conversation")}>
          <div className="page-conversation-thread">
            <ol className="chat coach-panel-messages" aria-label={t("questionnaire.transcript")}>
              <OnboardingWelcome />
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
        <ProfileOnboarding key={resumed?.id ?? ""} {...(resumed ? { resumed } : {})} />
      )}
    </CandidateLayout>
  );
}

/** The Profile `id` to resume, if it is the Candidate's and its onboarding is in progress; their other Profiles open their page. */
async function resumedProfile(candidateId: string, id: string): Promise<ResumedProfile | null> {
  const profile = await getProfiles().get(candidateId, id);
  if (!profile) return null;
  if (profile.onboarding !== "in_progress" || profile.archived) redirect(routes.profile(profile.id));
  return { id: profile.id, version: profile.masterCv.version, masterCv: profile.masterCv.content, searchCriteria: profile.searchCriteria };
}
