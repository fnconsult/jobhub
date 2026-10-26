import type { ReactNode } from "react";
import type { BackOfficeAccess } from "@/admin/access";
import { backOfficeNav, showsCount, type BackOfficeCounts } from "@/admin/back-office-nav";
import { getSignalements } from "@/signalements/server";
import { BackOfficeSidebarLayout } from "@/components/BackOfficeSidebarLayout";
import { CoachPanel, type PanelKind } from "@/components/CoachPanel";

const BACK_OFFICE_ASSISTANT: PanelKind = "backOfficeAssistant";

/**
 * The frame of every Back Office page: the Back Office's sidebar layout, with only
 * the sections `access` covers, around `children` (the page's `<main>`). Its top bar
 * opens the Back Office Assistant (#205) in place of the Candidate's Coach Panel,
 * and shows the page's `title` (its `<h1>`). Next to Signalements, those who change them see how many are
 * « à traiter » (#376), read afresh on every page.
 */
export async function BackOfficeLayout({ access, title, children }: { access: BackOfficeAccess; title?: ReactNode; children: ReactNode }) {
  const counts: BackOfficeCounts = showsCount(access, "signalements") ? { signalements: await getSignalements().countToHandle() } : {};
  return (
    <CoachPanel kind={BACK_OFFICE_ASSISTANT}>
      <BackOfficeSidebarLayout groups={backOfficeNav(access, counts)} title={title}>{children}</BackOfficeSidebarLayout>
    </CoachPanel>
  );
}
