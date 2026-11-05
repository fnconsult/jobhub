"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AiActivityLiveProvider } from "@/components/AiActivityLive";
import { SignalementProvider } from "@/components/Signalement";
import { CoachActionsOnContext } from "@/components/coach-actions-on";
import { routes } from "@/routes";

/**
 * Above every page a signed-in Candidate sees but the Back Office's (#608): AI Activity's live actions, which follow the
 * Candidate from page to page (#333), and the Signalement dialog for a page with no Work Pane (an error page's
 * « Signaler un problème », #542). `version`: the Jobbbox version the dialog's detail shows. `coachActions`: whether the
 * AI Coach is offered Coach Actions (#719), which the Coach Memory's proposals follow.
 */
export function CandidateProviders({ version, coachActions = false, children }: { version: string; coachActions?: boolean; children: ReactNode }) {
  const pathname = usePathname();
  const inBackOffice = pathname === routes.admin || pathname.startsWith(`${routes.admin}/`);
  if (inBackOffice) return children;
  return (
    <CoachActionsOnContext.Provider value={coachActions}>
      <AiActivityLiveProvider>
        <SignalementProvider version={version}>{children}</SignalementProvider>
      </AiActivityLiveProvider>
    </CoachActionsOnContext.Provider>
  );
}
