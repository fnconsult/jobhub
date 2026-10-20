import type { ReactNode } from "react";
import { CandidateLayout } from "@/components/CandidateLayout";
import { SectionsLayout } from "@/components/SectionsLayout";
import { getServerT } from "@/i18n/server";
import { routes } from "@/routes";

/**
 * Mon compte's frame: the sidebar layout titled Mon compte, around its Sections
 * (ADR-0024). The Subscription is one of them, though it keeps its own address
 * (/abonnement), which Stripe and shared promotion links lead to.
 */
export async function AccountSections({ candidateId, children }: { candidateId: string; children: ReactNode }) {
  const t = await getServerT();
  const sections = [
    { href: routes.accountProfiles, label: t("account.sections.profiles") },
    { href: routes.subscription, label: t("sidebar.subscription") },
    { href: routes.accountFollowUps, label: t("account.sections.followUps") },
    { href: routes.accountEuAi, label: t("account.sections.euAi") },
    { href: routes.accountSignIn, label: t("account.sections.signIn") },
    { href: routes.accountPreferences, label: t("account.sections.preferences") },
    { href: routes.accountTools, label: t("account.sections.tools") },
    { href: routes.accountData, label: t("account.sections.data") },
  ];
  return (
    <CandidateLayout candidateId={candidateId} title={t("account.title")}>
      <SectionsLayout base={routes.account} label={t("account.sections.sectionsLabel")} backLabel={t("account.sections.backToSections")} sections={sections}>
        {children}
      </SectionsLayout>
    </CandidateLayout>
  );
}
