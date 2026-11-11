import type { ReactNode } from "react";
import { coachingNoticesOn } from "@/coaching-notifications/activation-server";
import { CoachSpaceLayout } from "@/coach-space/CoachSpaceLayout";
export function CoachSpaceShell({ children }: { children: ReactNode }) {
  return <CoachSpaceLayout remindersEnabled={coachingNoticesOn()}>{children}</CoachSpaceLayout>;
}
