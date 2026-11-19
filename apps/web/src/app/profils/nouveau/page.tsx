import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { CandidateLayout } from "@/components/CandidateLayout";
import { OnboardingWelcome, ProfileOnboarding, type ResumedProfile } from "@/components/ProfileOnboarding";
import { UpgradePrompt } from "@/components/UpgradePrompt";
import { getEuAiConsents } from "@/eu-ai-consent/server";
import { getServerT } from "@/i18n/server";
import { getProfiles, newProfileStartFor } from "@/profiles/server";
import { routes } from "@/routes";
import { postponeOnboarding } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("newProfile.title")} · ${t("app.name")}` };
}

/**
 * Creating a Profile from an uploaded CV, the Onboarding Questionnaire or from scratch (no LinkedIn import of any kind,
 * ADR-0001), the page a conversation with the AI Coach (ADR-0070, see ProfileOnboarding). When the Plan allows no more
 * Profiles, the conversation's card is the Upgrade prompt, after the same welcome panel (#997). With `?profil=<id>`, a
 * Profile of the Candidate born during its onboarding and not finished (ADR-0106, #999) resumes at its review, or, left
 * with « Continuer plus tard », in its interview at the block it reached (#1046): it counts
 * in the Plan Quota already. Any other Profile of theirs opens its own page. Without it, once the Plan allows no more
 * Profiles, their most recent Profile « Création à terminer » resumes there instead of the Upgrade prompt (#1048).
 * Whether the Candidate has given EU AI Consent decides whether it is proposed before their CV is read (#1052).
 * A Candidate without any Profile is led here from `/` and `/compte` (#1050), and offered « Plus tard », to Mon compte.
 * Without any finished Profile, it is their first welcome (#1051): on a wide screen the conversation and Activité split in
 * two from the first question; on a phone, the offered Job Search's first offers come as a card in the thread.
 */
export default async function NewProfilePage({ searchParams }: { searchParams: Promise<{ profil?: string | string[] }> }) {
  const candidate = await getCurrentCandidate();
  if (!candidate) return signInRedirect();
  const [t, { profil }] = await Promise.all([getServerT(), searchParams]);
  const resumed = typeof profil === "string" ? await resumedProfile(candidate.id, profil) : null;
  const [start, euAiConsentGiven] = await Promise.all([resumed ? null : newProfileStartFor(candidate), getEuAiConsents().has(candidate.id)]);
  if (start?.start === "resume") redirect(routes.resumeProfileCreation(start.profileId));
  const upgradePrompt = start?.start === "upgrade" ? start.prompt : null;
  // « Plus tard » (#1050): offered as the « Entretien d'accueil » opens for a Candidate without any Profile.
  const firstProfile = start?.start === "onboarding" && (await getProfiles().list(candidate.id)).length === 0;
  // The first welcome (#1051): no finished Profile yet, the interview shown (not the Upgrade prompt).
  const firstWelcome = !upgradePrompt && !(await getProfiles().hasFinished(candidate.id));
  return (
    <CandidateLayout candidateId={candidate.id} title={t("newProfile.title")} split={firstWelcome}>
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
        <ProfileOnboarding key={resumed?.id ?? ""} euAiConsentGiven={euAiConsentGiven} {...(resumed ? { resumed } : {})} {...(firstProfile ? { postpone: postponeOnboarding } : {})} firstWelcome={firstWelcome} />
      )}
    </CandidateLayout>
  );
}

/** The Profile `id` to resume, if it is the Candidate's and its onboarding is in progress; their other Profiles open their page. */
async function resumedProfile(candidateId: string, id: string): Promise<ResumedProfile | null> {
  const profile = await getProfiles().get(candidateId, id);
  if (!profile) return null;
  if (profile.onboarding !== "in_progress" || profile.archived) redirect(routes.profile(profile.id));
  return {
    id: profile.id,
    version: profile.masterCv.version,
    masterCv: profile.masterCv.content,
    searchCriteria: profile.searchCriteria,
    // Left with « Continuer plus tard » (#1046): its interview reopens at the block it reached.
    ...(profile.onboardingResumesAt ? { resumesAt: profile.onboardingResumesAt } : {}),
  };
}
