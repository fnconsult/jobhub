"use client";

import { createContext, useContext } from "react";

/**
 * What the Fiche's Activity group, or the Activité column, lets the page do with it (#808, #809, ADR-0086), shared without
 * Fiche.tsx and AiActivity.tsx importing each other: AI Activity's button in the Top Bar shows it or hides it; « Dans
 * l'activité » in the thread opens it on its Activity; and « Voir dans la conversation » closes it where it covers the
 * conversation, on a phone.
 */
export type ActivityColumn = {
  /** Activity is shown: the Fiche open on its Activity group, unfolded, or the Activité column open, neither given way. */
  shown: boolean;
  /** AI Activity's button: shows Activity, bringing back a Fiche that gave way, or hides it (folds the Fiche's group). */
  toggle: () => void;
  /** The column the button controls, while it is open (`aria-controls`). */
  controls: string | undefined;
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
