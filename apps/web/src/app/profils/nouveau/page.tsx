import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentCandidate } from "@/auth/server";
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

/** Creating a Profile from an uploaded CV, the Onboarding Questionnaire or from scratch (no LinkedIn import of any kind, ADR-0001). */
export default async function NewProfilePage() {
  const candidate = await getCurrentCandidate();
  if (!candidate) redirect(routes.signIn);
  const t = await getServerT();
  const upgradePrompt = await profileUpgradePromptFor(candidate);
  return (
    <CandidateLayout candidateId={candidate.id}>
      <h1>{t("newProfile.title")}</h1>
      {upgradePrompt ? (
        <>
          <UpgradePrompt prompt={upgradePrompt} />
          <Link href={routes.account}>{t("profile.backToAccount")}</Link>
        </>
      ) : (
        <>
          <p className="lead">{t("newProfile.intro")}</p>
          <ProfileOnboarding />
        </>
      )}
    </CandidateLayout>
  );
}
