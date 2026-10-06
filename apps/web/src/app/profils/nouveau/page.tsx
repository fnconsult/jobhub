import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentCandidate } from "@/auth/server";
import { CvOnboarding } from "@/components/CvOnboarding";
import { WorkspaceHeader } from "@/components/WorkspaceHeader";
import { getServerT } from "@/i18n/server";
import { getProfiles } from "@/profiles/server";
import { routes } from "@/routes";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("cvUpload.title")} · ${t("app.name")}` };
}

/** Creating a Profile from an uploaded CV or from scratch (no LinkedIn import of any kind, ADR-0001). */
export default async function NewProfilePage() {
  const candidate = await getCurrentCandidate();
  if (!candidate) redirect(routes.signIn);
  const t = await getServerT();
  const canAdd = await getProfiles().canAddProfile(candidate.id);
  return (
    <main className="page">
      <WorkspaceHeader candidateId={candidate.id} />
      <h1>{t("cvUpload.title")}</h1>
      {canAdd ? (
        <>
          <p className="lead">{t("cvUpload.intro")}</p>
          <CvOnboarding />
        </>
      ) : (
        <>
          <p className="notice">{t("profiles.quotaReached")}</p>
          <Link href={routes.account}>{t("profile.backToAccount")}</Link>
        </>
      )}
    </main>
  );
}
