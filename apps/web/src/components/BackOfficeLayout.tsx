import type { ReactNode } from "react";
import type { BackOfficeAccess } from "@/admin/access";
import { backOfficeNav, showsCount, type BackOfficeCounts } from "@/admin/back-office-nav";
import { getSignalements } from "@/signalements/server";
import { BackOfficeSidebarLayout } from "@/components/BackOfficeSidebarLayout";
import { BackOfficeAssistantPanel } from "@/components/BackOfficeAssistantPanel";
import { OverlayScope } from "@/design/overlay";
import { currentRelease, releaseLabel } from "@/release";

/** The Back Office's Density (ADR-0053, ADR-0009's Compact amendment). */
const COMPACT = "compact";

/**
 * The frame of every Back Office page: the Back Office's sidebar layout, with only
 * the sections `access` covers, around `children` (the page's `<main>`). Its top bar
 * opens the Back Office Assistant (#205), the Coach Panel of the Back Office alone (ADR-0070), all in the Compact Density,
 * and shows the page's `title` (its `<h1>`). Next to Signalements, those who change them see how many are
 * « à traiter » (#376), read afresh on every page. Its Drawers open inside it (an OverlayScope), so they are in the
 * Compact Density too (#465). The sidebar's foot names the Version served (#559).
 */
export async function BackOfficeLayout({ access, title, children }: { access: BackOfficeAccess; title?: ReactNode; children: ReactNode }) {
  const counts: BackOfficeCounts = showsCount(access, "signalements") ? { signalements: await getSignalements().countToHandle() } : {};
  // The Back Office is read by Administrators: the Compact Density (ADR-0053, ADR-0009's Compact amendment).
  return (
    <OverlayScope data-density={COMPACT} className="density-scope">
      <BackOfficeAssistantPanel>
        <BackOfficeSidebarLayout groups={backOfficeNav(access, counts)} title={title} release={releaseLabel(currentRelease())}>
          {children}
        </BackOfficeSidebarLayout>
      </BackOfficeAssistantPanel>
    </OverlayScope>
  );
}
