"use client";

import { createContext, useContext } from "react";

/**
 * Whether the AI Coach is offered Coach Actions (ADR-0077: COACH_ACTIONS_ENABLED on, with rounds), as the pages of a
 * signed-in Candidate know it (CandidateProviders). On, the Coach proposes what to remember through a Coach Action, one
 * card per fact (#719), in place of « Que retenir de cette conversation ? ». Off by default, and outside those pages.
 */
export const CoachActionsOnContext = createContext(false);

export function useCoachActionsOn(): boolean {
  return useContext(CoachActionsOnContext);
}
