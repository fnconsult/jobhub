import type { ReactNode } from "react";
import type { BackOfficeAccess } from "@/admin/access";
import { backOfficeNav } from "@/admin/back-office-nav";
import { BackOfficeSidebarLayout } from "@/components/BackOfficeSidebarLayout";
import { CoachPanel, type PanelKind } from "@/components/CoachPanel";

const BACK_OFFICE_ASSISTANT: PanelKind = "backOfficeAssistant";

/**
 * The frame of every Back Office page: the Back Office's sidebar layout, with only
 * the sections `access` covers, around `children` (the page's `<main>`). Its top bar
 * opens the Back Office Assistant (#205) in place of the Candidate's Coach Panel,
 * and shows the page's `title` (its `<h1>`).
 */
export function BackOfficeLayout({ access, title, children }: { access: BackOfficeAccess; title?: ReactNode; children: ReactNode }) {
  return (
    <CoachPanel kind={BACK_OFFICE_ASSISTANT}>
      <BackOfficeSidebarLayout groups={backOfficeNav(access)} title={title}>{children}</BackOfficeSidebarLayout>
    </CoachPanel>
  );
}
