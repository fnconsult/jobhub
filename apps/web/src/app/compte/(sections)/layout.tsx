import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentCandidate } from "@/auth/server";
import { CandidateLayout } from "@/components/CandidateLayout";
import { SectionsLayout } from "@/components/SectionsLayout";
import { getServerT } from "@/i18n/server";
import { routes } from "@/routes";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("account.title")} · ${t("app.name")}` };
}

/** Mon compte, split into its Sections (ADR-0024): each a page of its own under /compte. */
export default async function AccountLayout({ children }: { children: ReactNode }) {
  const candidate = await getCurrentCandidate();
  if (!candidate) redirect(routes.signIn);
  const t = await getServerT();
  const sections = [
    { href: routes.accountProfiles, label: t("account.sections.profiles") },
    { href: routes.accountFollowUps, label: t("account.sections.followUps") },
    { href: routes.accountEuAi, label: t("account.sections.euAi") },
    { href: routes.accountSignIn, label: t("account.sections.signIn") },
    { href: routes.accountPreferences, label: t("account.sections.preferences") },
    { href: routes.accountData, label: t("account.sections.data") },
  ];
  return (
    <CandidateLayout candidateId={candidate.id} title={t("account.title")}>
      <SectionsLayout base={routes.account} label={t("account.sections.sectionsLabel")} backLabel={t("account.sections.backToSections")} sections={sections}>
        {children}
      </SectionsLayout>
    </CandidateLayout>
  );
}
