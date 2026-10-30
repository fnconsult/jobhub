/** What the Viewer shows (#468): the page in view, the page count (0 until the file is read) and the zoom, in percent. */
export type ViewerState = { page: number; pages: number; zoom: number };

export type ViewerAction =
  | { type: "loaded"; pages: number }
  | { type: "page"; page: number }
  | { type: "zoomIn" }
  | { type: "zoomOut" }
  | { type: "fit"; zoom: number };

export const MIN_ZOOM = 50;
export const MAX_ZOOM = 200;
const STEP = 25;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const initialViewer: ViewerState = { page: 1, pages: 0, zoom: 100 };

/**
 * The Viewer's next state: − and + step the zoom to the next 25 % mark (from a fitted zoom too), between 50 % and
 * 200 %; the page in view stays between 1 and the page count.
 */
export function nextViewer(state: ViewerState, action: ViewerAction): ViewerState {
  switch (action.type) {
    case "loaded":
      return { ...state, pages: action.pages, page: clamp(state.page, 1, Math.max(1, action.pages)) };
    case "page":
      return { ...state, page: clamp(action.page, 1, Math.max(1, state.pages)) };
    case "zoomIn":
      return { ...state, zoom: clamp(Math.floor(state.zoom / STEP) * STEP + STEP, MIN_ZOOM, MAX_ZOOM) };
    case "zoomOut":
      return { ...state, zoom: clamp(Math.ceil(state.zoom / STEP) * STEP - STEP, MIN_ZOOM, MAX_ZOOM) };
    case "fit":
      return { ...state, zoom: clamp(action.zoom, MIN_ZOOM, MAX_ZOOM) };
  }
}

/** « Ajuster »: the zoom that makes a page (`pageWidth` at 100 %) as wide as the space `available`, in whole percent. */
export function fitZoom({ pageWidth, available }: { pageWidth: number; available: number }): number {
  return clamp(Math.floor((available / pageWidth) * 100), MIN_ZOOM, MAX_ZOOM);
}

/** The zoom in words, « 125 % » in French, « 125% » in English. */
export function zoomLabel(zoom: number, language: string): string {
  return new Intl.NumberFormat(language.startsWith("en") ? "en" : "fr", { style: "percent", maximumFractionDigits: 0 }).format(zoom / 100);
}
