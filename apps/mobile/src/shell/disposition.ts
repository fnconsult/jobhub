/**
 * Where the app's shell puts the Sidebar, the conversation and its panes (ADR-0070, as ADR-0076 applies it to the app's
 * window): measured in rem, 16 pt times the system text scale, so a larger Dynamic Type or font scale narrows the window
 * as a narrower screen would, and computed again whenever the window changes (rotation, Split View, Stage Manager, a
 * foldable).
 *
 * - Below 64rem the conversation takes the window, the Sidebar is a drawer, and the Fiche, the Activité column and the
 *   Work Pane open full page over it, the Work Pane over the Fiche. The conversation's side margin is then a gutter
 *   that stops growing at 16 pt: a larger text keeps the window's width for its words (#905).
 * - From 64rem they are columns beside the conversation, a 1rem gutter around each. Where the Fiche and the Work Pane
 *   together would leave the conversation under 28rem, the Work Pane takes the Fiche's place, the Sidebar counted as
 *   the person left it (below 100rem with it, 76.5rem without). The Sidebar is then a column while the conversation
 *   keeps 28rem beside it, a drawer otherwise.
 */

/** The window, in points, and the system's text scale (`useWindowDimensions`). */
export type AppWindow = { width: number; fontScale: number };

/** The page's column: the Fiche of an object, or Activité alone on the home page and the menus. */
export type PaneKind = "fiche" | "activite";
export type ShownPane = PaneKind | "workPane";

/** What the person has open, or wants: the Sidebar not hidden, the page's column, a Work Pane item. */
export type Wanted = { sidebar: boolean; pane: PaneKind | null; workPane: boolean };

export type Disposition = {
  /** One rem, in points. */
  rem: number;
  widthRem: number;
  /** A column beside the page, a drawer over it, or hidden by the person (the menu button brings it back). */
  sidebar: "column" | "drawer" | "hidden";
  /** The panes beside the conversation, or each over the page and the Top Bar. */
  panes: "columns" | "fullPage";
  /** The panes drawn, in order: the Fiche or Activité first, the Work Pane last (on top, full page). */
  shown: ShownPane[];
  /** Widths in points. */
  /** `margin`: each side of the conversation, the gutter beside columns; full page, a gutter of 16 pt at most. */
  size: { sidebar: number; fiche: number; workPane: number; gutter: number; margin: number };
};

/** In rem, as on the web (apps/web/src/components/Fiche.tsx). */
const ROOT_PT = 16;
const WIDE = 64;
const CONVERSATION_MIN = 28;
const SIDEBAR = 16;
const FICHE = 20;
const GUTTER = 1;
/** The Work Pane: 32 % of the window, from 20 to 32rem. */
const workPaneRem = (widthRem: number) => Math.min(32, Math.max(20, 0.32 * widthRem));

export function disposition(window: AppWindow, wanted: Wanted): Disposition {
  const rem = ROOT_PT * window.fontScale;
  const widthRem = window.width / rem;
  const workPane = workPaneRem(widthRem);
  const gutter = GUTTER * rem;
  const size = { sidebar: SIDEBAR * rem, fiche: FICHE * rem, workPane: workPane * rem, gutter, margin: gutter };
  const wantedPanes: ShownPane[] = [...(wanted.pane ? [wanted.pane] : []), ...(wanted.workPane ? ["workPane" as const] : [])];

  // Full page, a gutter growing with the text only takes its width from the words: 57 pt each side of an iPhone SE's
  // 375 at iOS's largest size, where « Propose / r une idée » and « Contrôleus / e de gestion » broke mid-word (#905).
  if (widthRem < WIDE) return { rem, widthRem, sidebar: "drawer", panes: "fullPage", shown: wantedPanes, size: { ...size, margin: Math.min(gutter, GUTTER * ROOT_PT) } };

  const widthOf = (pane: ShownPane) => (pane === "workPane" ? workPane : FICHE);
  /** What the conversation keeps beside `columns`, a gutter on each side of it and after each column. */
  const conversation = (columns: ShownPane[], sidebar: boolean) =>
    widthRem - (sidebar ? SIDEBAR : 0) - columns.reduce((sum, pane) => sum + widthOf(pane) + GUTTER, 0) - 2 * GUTTER;

  const roomForBoth = wantedPanes.length < 2 || conversation(wantedPanes, wanted.sidebar) >= CONVERSATION_MIN;
  const shown = roomForBoth ? wantedPanes : ["workPane" as const];
  const sidebarFits = conversation(shown, true) >= CONVERSATION_MIN;
  const sidebar = !sidebarFits ? "drawer" : wanted.sidebar ? "column" : "hidden";
  return { rem, widthRem, sidebar, panes: "columns", shown, size };
}
