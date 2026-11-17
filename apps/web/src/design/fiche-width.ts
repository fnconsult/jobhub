import {
  applyPanelWidths,
  clampPanelWidth,
  panelMaxWidth,
  panelWidthFromKey,
  readPanelWidth,
  setPanelWidthProperty,
  SIDE_PANEL_WIDTH,
  writePanelWidth,
  type PanelBounds,
} from "./panel-width";

/**
 * How wide the Fiche (the side panel) is beside the conversation (#932): 20rem by default, which is also its narrowest,
 * and as wide as the Candidate drags its handle, up to half the window, 44rem at most, and never so wide that the
 * conversation keeps less than 28rem. The side panel's instance of panel-width.ts, which the Work Pane shares.
 */
export const FICHE_WIDTH_STORAGE_KEY = SIDE_PANEL_WIDTH.storageKey;
export const FICHE_MIN_REM = SIDE_PANEL_WIDTH.minRem;
export const FICHE_MAX_REM = SIDE_PANEL_WIDTH.maxRem;

export const ficheMaxWidth = ({ viewport, workspace, workPane, rem }: { viewport: number; workspace: number; workPane: number; rem: number }) =>
  panelMaxWidth(SIDE_PANEL_WIDTH, { viewport, workspace, other: workPane, rem });
export const clampFicheWidth = clampPanelWidth;
export const ficheWidthFromKey = (key: string, width: number, bounds: PanelBounds, rem = 16) => panelWidthFromKey(key, width, bounds, rem);
export const readFicheWidth = () => readPanelWidth(SIDE_PANEL_WIDTH);
export const writeFicheWidth = (width: number | null) => writePanelWidth(SIDE_PANEL_WIDTH, width);
export const setFicheWidthProperty = (width: number | null) => setPanelWidthProperty(SIDE_PANEL_WIDTH, width);
/** Inline script for the document head: applies the remembered widths (the side panel's and the Work Pane's) before first paint. */
export const applyFicheWidth = applyPanelWidths;
