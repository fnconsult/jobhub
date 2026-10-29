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
 * opens the Back Office Assistant (#205) in place of the Candidate's Coach Panel, all in the Compact Density,
 * and shows the page's `title` (its `<h1>`). Next to Signalements, those who change them see how many are
 * « à traiter » (#376), read afresh on every page. `inDesignSystem`: the page is drawn in the Design System's Compact
 * Density (#465: Paramètres, the Dashboard and Activité first; #466 the other sections), its tabs, tables, pills, cards
 * and side panels styled as the Design System's.
 */
export async function BackOfficeLayout({ access, title, inDesignSystem = false, children }: { access: BackOfficeAccess; title?: ReactNode; inDesignSystem?: boolean; children: ReactNode }) {
  const counts: BackOfficeCounts = showsCount(access, "signalements") ? { signalements: await getSignalements().countToHandle() } : {};
  // The Back Office is read by Administrators: the Compact Density (ADR-0053, ADR-0009's Compact amendment).
  return (
    <div data-density="compact" className="density-scope">
      <CoachPanel kind={BACK_OFFICE_ASSISTANT}>
        <BackOfficeSidebarLayout groups={backOfficeNav(access, counts)} title={title}>
          {inDesignSystem ? <div className="in-design-system">{children}</div> : children}
        </BackOfficeSidebarLayout>
      </CoachPanel>
    </div>
  );
}
