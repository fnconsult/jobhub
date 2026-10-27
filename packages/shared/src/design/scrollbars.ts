/** The class the design stylesheet shows a scrollbar on (`renderDesignCss`): set only while its area scrolls. */
export const SCROLLING_CLASS = "is-scrolling";

type Marked = { classList: { add(name: string): void; remove(name: string): void } };
type ScrollListener = (event: { target: unknown }) => void;

/** What trackScrolling needs of a document: its scroll events, and the element that scrolls the page. */
export type ScrollingDocument = {
  scrollingElement: Marked | null;
  addEventListener(type: "scroll", listener: ScrollListener, options: { capture: true; passive: true }): void;
  removeEventListener(type: "scroll", listener: ScrollListener, options: { capture: true }): void;
};

/**
 * Shows an area's scrollbar only while it scrolls (ADR-0053): marks it with `is-scrolling` on each scroll and
 * unmarks it `idleMs` after the last one. The page itself is marked on its scrolling element. Returns a function
 * that stops tracking.
 */
export function trackScrolling(document: ScrollingDocument, { idleMs = 800 }: { idleMs?: number } = {}): () => void {
  const timers = new Map<Marked, ReturnType<typeof setTimeout>>();
  const onScroll: ScrollListener = ({ target }) => {
    const area = (target === document ? document.scrollingElement : target) as Marked | null;
    if (!area?.classList) return;
    area.classList.add(SCROLLING_CLASS);
    clearTimeout(timers.get(area));
    timers.set(
      area,
      setTimeout(() => {
        area.classList.remove(SCROLLING_CLASS);
        timers.delete(area);
      }, idleMs),
    );
  };
  document.addEventListener("scroll", onScroll, { capture: true, passive: true });
  return () => {
    document.removeEventListener("scroll", onScroll, { capture: true });
    timers.forEach(clearTimeout);
    timers.clear();
  };
}
