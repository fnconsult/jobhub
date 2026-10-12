/**
 * Whether the Candidate hid the sidebar on a wide screen. It lives on
 * <html data-sidebar>, set before first paint from this browser's storage (a
 * per-browser convenience, like the Text Size), so a hidden sidebar never
 * flashes in on load.
 */
export const SIDEBAR_STORAGE_KEY = "jobbbox.sidebar";
export const SIDEBAR_CLOSED = "closed";
export const SIDEBAR_OPEN = "open";

/** Inline script for the document head: applies the remembered state before first paint. */
export const applySidebarState = `try{if(localStorage.getItem(${JSON.stringify(SIDEBAR_STORAGE_KEY)})===${JSON.stringify(
  SIDEBAR_CLOSED,
)})document.documentElement.dataset.sidebar=${JSON.stringify(SIDEBAR_CLOSED)}}catch(e){}`;
