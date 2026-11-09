/**
 * How wide the Fiche is beside the conversation (#932): 20rem by default, which is also its narrowest, and as wide as the
 * Candidate drags its handle, up to half the window, 44rem at most, and never so wide that the conversation keeps less
 * than 28rem (the width under which it no longer reads, see Fiche.tsx's ROOM_FOR_BOTH). The Candidate's choice is a
 * per-browser convenience, like the Text Size: kept in localStorage and set on <html> as `--fiche-width` before first
 * paint, so the Fiche never jumps on load. app.css clamps it between the same limits (`--fiche-max`, set by the Fiche
 * from what it measures, and a first-paint estimate in vw before that).
 */
export const FICHE_WIDTH_STORAGE_KEY = "jobbbox.fiche-width";
export const FICHE_MIN_REM = 20;
export const FICHE_MAX_REM = 44;
/** The conversation's narrowest, and its gutters beside the Fiche: 1rem either side of it, 1rem right of the Fiche. */
const CONVERSATION_MIN_REM = 28;
const GUTTERS_REM = 3;
/** ← and → move the handle by 2rem. */
const STEP_REM = 2;
/** Only a stored width this size or less is a width (a stray value never makes the Fiche absurd). */
const LARGEST_STORED_PX = 4096;

/**
 * The widest the Fiche may be, in px: `viewport` the window's width, `workspace` the width of the conversation and its
 * columns (the window less the Sidebar), `workPane` the Work Pane's width when it is open beside them (0 otherwise),
 * `rem` the root font size, which the Text Size changes. Never under the Fiche's default.
 */
export function ficheMaxWidth({ viewport, workspace, workPane, rem }: { viewport: number; workspace: number; workPane: number; rem: number }): number {
  const leftForFiche = workspace - (CONVERSATION_MIN_REM + GUTTERS_REM) * rem - (workPane > 0 ? workPane + rem : 0);
  const widest = Math.min(FICHE_MAX_REM * rem, viewport / 2, leftForFiche);
  return Math.max(FICHE_MIN_REM * rem, Math.floor(widest));
}

export const clampFicheWidth = (width: number, { min, max }: { min: number; max: number }) => Math.round(Math.min(max, Math.max(min, width)));

/**
 * The width a key on the handle gives (WAI-ARIA window splitter): ← moves the handle left, so widens the Fiche, → narrows
 * it, Home goes to its narrowest, End to its widest. Null for any other key.
 */
export function ficheWidthFromKey(key: string, width: number, bounds: { min: number; max: number }, rem = 16): number | null {
  const step = STEP_REM * rem;
  switch (key) {
    case "ArrowLeft":
      return clampFicheWidth(width + step, bounds);
    case "ArrowRight":
      return clampFicheWidth(width - step, bounds);
    case "Home":
      return bounds.min;
    case "End":
      return bounds.max;
    default:
      return null;
  }
}

/** The width this browser remembers, in px; null when there is none or storage cannot be read. */
export function readFicheWidth(): number | null {
  try {
    const stored = Number(window.localStorage.getItem(FICHE_WIDTH_STORAGE_KEY));
    return Number.isFinite(stored) && stored > 0 && stored <= LARGEST_STORED_PX ? stored : null;
  } catch {
    return null;
  }
}

/** Remembers `width` (px) in this browser, or forgets it (null, the default width again). Never throws. */
export function writeFicheWidth(width: number | null) {
  try {
    if (width === null) window.localStorage.removeItem(FICHE_WIDTH_STORAGE_KEY);
    else window.localStorage.setItem(FICHE_WIDTH_STORAGE_KEY, String(Math.round(width)));
  } catch {
    // Private browsing or blocked storage: the width holds for this page only.
  }
}

/** Sets the Fiche's width on <html> as `--fiche-width` (null removes it). */
export function setFicheWidthProperty(width: number | null) {
  const root = document.documentElement.style;
  if (width === null) root.removeProperty("--fiche-width");
  else root.setProperty("--fiche-width", `${Math.round(width)}px`);
}

/** Inline script for the document head: applies the remembered width before first paint. */
export const applyFicheWidth = `try{var w=Number(localStorage.getItem(${JSON.stringify(FICHE_WIDTH_STORAGE_KEY)}));if(w>0&&w<=${LARGEST_STORED_PX})document.documentElement.style.setProperty("--fiche-width",Math.round(w)+"px")}catch(e){}`;
