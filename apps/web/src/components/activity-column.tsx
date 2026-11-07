"use client";

import { createContext, useContext } from "react";

/**
 * What the Fiche's Activity group, or the Activité column, lets the page do with it (#808, ADR-0086), shared without
 * Fiche.tsx and AiActivity.tsx importing each other: open it on its Activity (« Dans l'activité » in the thread), and
 * close it where it covers the conversation, on a phone (« Voir dans la conversation »).
 */
export type ActivityColumn = {
  /** Opens the Fiche on its Activity group, unfolded, or the Activité column; nothing when it is shown already. */
  open: () => void;
  /** On a phone, where it covers the conversation, closes it; beside the conversation, nothing. */
  closeOverConversation: () => void;
};

export const ActivityColumnControl = createContext<ActivityColumn | null>(null);

/** The page's Activity column, null outside a FicheProvider (the Back Office). */
export function useActivityColumn(): ActivityColumn | null {
  return useContext(ActivityColumnControl);
}
