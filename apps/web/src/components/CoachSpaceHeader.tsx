import type { ReactNode } from "react";
import { coachingNoticesOn } from "@/coaching-notifications/activation-server";
import { CoachSpaceLayout } from "@/coach-space/CoachSpaceLayout";
import { LegacyCoachSpaceHeader, LegacyCoachSpaceShell } from "@/coach-space/legacy/LegacyCoachSpaceShell";
import { coachSpaceV2On } from "@/coach-space-v2/server";

/** Header of a Human Coach's pages in the old Coach space (« Espace coach v2 » off). */
export const CoachSpaceHeader = LegacyCoachSpaceHeader;

/**
 * A Human Coach's page. « Espace coach v2 » on (ADR-0106): the workspace's sidebar layout; off: the old Coach space's
 * header, the page, then the public site's footer, as before the Human Coach epic.
 */
export function CoachSpaceShell({ children }: { children: ReactNode }) {
  if (!coachSpaceV2On()) return <LegacyCoachSpaceShell>{children}</LegacyCoachSpaceShell>;
  return <CoachSpaceLayout remindersEnabled={coachingNoticesOn()}>{children}</CoachSpaceLayout>;
}
