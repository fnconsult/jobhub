/**
 * How wide a column beside the conversation is, when the Candidate drags its handle (#932): the side panel (« Fiche »,
 * « Documents »…) and the Work Pane, where Sections, Results and Job Offers open. Each has its narrowest, the width at
 * which what it holds fits without a horizontal scrollbar, and its widest: half the window, a cap in rem, and never so
 * wide that the conversation keeps less than 28rem (the width under which it no longer reads, see Fiche.tsx's
 * ROOM_FOR_BOTH) beside it and the other column. The Candidate's choice is a per-browser convenience, like the Text Size:
 * kept in localStorage and set on <html> as a custom property before first paint, so the column never jumps on load.
 * app.css clamps it between the same limits (a `--…-max` the column sets from what it measures, and a first-paint
 * estimate in vw before that).
 */
export type PanelWidthSpec = {
  /** localStorage key of the width this browser remembers. */
  storageKey: string;
  /** The custom property set on <html>, which app.css reads. */
  property: `--${string}`;
  /** The custom property the column sets on itself from what it measures: its widest, which app.css reads. */
  maxProperty: `--${string}`;
  /** The narrowest, in rem. */
  minRem: number;
  /** The widest, in rem, before the window and the conversation limit it. */
  maxRem: number;
  /** The width it has when the Candidate never chose one, in px. */
  defaultWidth: (at: { viewport: number; rem: number }) => number;
};

/** The side panel: 20rem by default, which is also its narrowest (#932). */
export const SIDE_PANEL_WIDTH: PanelWidthSpec = {
  storageKey: "jobbbox.fiche-width",
  property: "--fiche-width",
  maxProperty: "--fiche-max",
  minRem: 20,
  maxRem: 44,
  defaultWidth: ({ rem }) => 20 * rem,
};

/** The Work Pane: 32% of the window by default, between 20rem and 32rem, as app.css draws it untouched. */
export const WORK_PANE_WIDTH: PanelWidthSpec = {
  storageKey: "jobbbox.work-pane-width",
  property: "--work-pane-width",
  maxProperty: "--work-pane-max",
  minRem: 20,
  maxRem: 56,
  defaultWidth: ({ viewport, rem }) => Math.round(Math.min(32 * rem, Math.max(20 * rem, viewport * 0.32))),
};

/** The conversation's narrowest, and its gutters beside a column: 1rem either side of it, 1rem right of the column. */
const CONVERSATION_MIN_REM = 28;
const GUTTERS_REM = 3;
/** ← and → move a handle by 2rem. */
const STEP_REM = 2;
/** Only a stored width this size or less is a width (a stray value never makes a column absurd). */
const LARGEST_STORED_PX = 4096;

export type PanelBounds = { min: number; max: number };

/**
 * The widest a column may be, in px: `viewport` the window's width, `workspace` the width of the conversation and its
 * columns (the window less the Sidebar), `other` the width of the other column when it is open beside them (0
 * otherwise), `rem` the root font size, which the Text Size changes. Never under the column's narrowest.
 */
export function panelMaxWidth(spec: PanelWidthSpec, { viewport, workspace, other, rem }: { viewport: number; workspace: number; other: number; rem: number }): number {
  const left = workspace - (CONVERSATION_MIN_REM + GUTTERS_REM) * rem - (other > 0 ? other + rem : 0);
  const widest = Math.min(spec.maxRem * rem, viewport / 2, left);
  return Math.max(spec.minRem * rem, Math.floor(widest));
}

export const clampPanelWidth = (width: number, { min, max }: PanelBounds) => Math.round(Math.min(max, Math.max(min, width)));

/**
 * The width a key on a handle gives (WAI-ARIA window splitter). Both handles are on their column's left edge: ← moves
 * the handle left, so widens the column, → narrows it, Home goes to its narrowest, End to its widest. Null for any other
 * key.
 */
export function panelWidthFromKey(key: string, width: number, bounds: PanelBounds, rem = 16): number | null {
  const step = STEP_REM * rem;
  switch (key) {
    case "ArrowLeft":
      return clampPanelWidth(width + step, bounds);
    case "ArrowRight":
      return clampPanelWidth(width - step, bounds);
    case "Home":
      return bounds.min;
    case "End":
      return bounds.max;
    default:
      return null;
  }
}

/** The width this browser remembers for a column, in px; null when there is none or storage cannot be read. */
export function readPanelWidth(spec: PanelWidthSpec): number | null {
  try {
    const stored = Number(window.localStorage.getItem(spec.storageKey));
    return Number.isFinite(stored) && stored > 0 && stored <= LARGEST_STORED_PX ? stored : null;
  } catch {
    return null;
  }
}

/** Remembers a column's `width` (px) in this browser, or forgets it (null, its default width again). Never throws. */
export function writePanelWidth(spec: PanelWidthSpec, width: number | null) {
  try {
    if (width === null) window.localStorage.removeItem(spec.storageKey);
    else window.localStorage.setItem(spec.storageKey, String(Math.round(width)));
  } catch {
    // Private browsing or blocked storage: the width holds for this page only.
  }
}

/** Sets a column's width on <html> as its custom property (null removes it). */
export function setPanelWidthProperty(spec: PanelWidthSpec, width: number | null) {
  const root = document.documentElement.style;
  if (width === null) root.removeProperty(spec.property);
  else root.setProperty(spec.property, `${Math.round(width)}px`);
}

/** Inline script for the document head: applies each column's remembered width before first paint. */
export const applyPanelWidths = [SIDE_PANEL_WIDTH, WORK_PANE_WIDTH]
  .map(
    ({ storageKey, property }) =>
      `try{var w=Number(localStorage.getItem(${JSON.stringify(storageKey)}));if(w>0&&w<=${LARGEST_STORED_PX})document.documentElement.style.setProperty(${JSON.stringify(property)},Math.round(w)+"px")}catch(e){}`,
  )
  .join("");
