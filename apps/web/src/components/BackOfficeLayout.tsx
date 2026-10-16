import type { ReactNode } from "react";
import type { BackOfficeAccess } from "@/admin/access";
import { backOfficeNav } from "@/admin/back-office-nav";
import { BackOfficeSidebarLayout } from "@/components/BackOfficeSidebarLayout";

/**
 * The frame of every Back Office page: the Back Office's sidebar layout, with only
 * the sections `access` covers, around `children` (the page's `<main>`).
 */
export function BackOfficeLayout({ access, children }: { access: BackOfficeAccess; children: ReactNode }) {
  return <BackOfficeSidebarLayout groups={backOfficeNav(access)}>{children}</BackOfficeSidebarLayout>;
}
