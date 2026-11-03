// PROTOTYPE (throwaway). ADR-0070's wide-screen rules, driven by the window width in rem (16pt × the OS text scale),
// so Split View, Stage Manager, foldables and a large Dynamic Type all fall back the same way the web does.
import { useWindowDimensions } from "react-native";

export const COL = { sidebar: 17, fiche: 22, gutter: 1, conversationMin: 28, wide: 64 } as const;

export type Layout = {
  width: number;
  height: number;
  fontScale: number;
  rem: number;
  widthRem: number;
  wide: boolean;
  /** Sidebar shown as a column (else a drawer over the page). */
  sidebarPinned: boolean;
  /** Fiche as a column beside the conversation (else a sheet over it). */
  ficheAsColumn: boolean;
  why: string;
};

export function useLayout(opts: { sidebarWanted: boolean; ficheOpen: boolean; hasSidebar: boolean }): Layout {
  const { width, height, fontScale } = useWindowDimensions();
  const rem = 16 * fontScale;
  const widthRem = width / rem;
  const wide = widthRem >= COL.wide;
  const ficheNeeds = COL.gutter + COL.fiche;
  const sidebarNeeds = COL.sidebar;
  let sidebarPinned = false;
  let ficheAsColumn = false;
  let why: string;
  if (!wide) {
    why = `< ${COL.wide}rem : disposition téléphone`;
  } else {
    ficheAsColumn = true;
    const withFiche = opts.ficheOpen ? ficheNeeds : 0;
    if (opts.hasSidebar && opts.sidebarWanted) {
      if (sidebarNeeds + COL.conversationMin + withFiche <= widthRem) {
        sidebarPinned = true;
        why = "barre latérale + conversation" + (opts.ficheOpen ? " + Fiche" : "");
      } else {
        why = `barre latérale en tiroir : la conversation garderait < ${COL.conversationMin}rem`;
      }
    } else {
      why = "colonnes sans barre latérale";
    }
  }
  return { width, height, fontScale, rem, widthRem, wide, sidebarPinned, ficheAsColumn, why };
}
