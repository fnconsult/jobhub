"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AiActivityLiveProvider } from "@/components/AiActivityLive";
import { SignalementProvider } from "@/components/Signalement";
import { routes } from "@/routes";

/**
 * Above every page a signed-in Candidate sees but the Back Office's (#608): AI Activity's live actions, which follow the
 * Candidate from page to page (#333), and the Signalement dialog for a page with no Work Pane (an error page's
 * « Signaler un problème », #542). `version`: the Jobbbox version the dialog's detail shows.
 */
export function CandidateProviders({ version, children }: { version: string; children: ReactNode }) {
  const pathname = usePathname();
  const inBackOffice = pathname === routes.admin || pathname.startsWith(`${routes.admin}/`);
  if (inBackOffice) return children;
  return (
    <AiActivityLiveProvider>
      <SignalementProvider version={version}>{children}</SignalementProvider>
    </AiActivityLiveProvider>
  );
}
