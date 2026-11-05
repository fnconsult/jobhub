/** The room kept above a reply's first line when it is brought into view: the thread's own gap. */
const ABOVE_REPLY = 16;

/** The element `element` scrolls in: its nearest ancestor that scrolls vertically, or the page itself. */
export function scrollerOf(element: Element): Element {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent);
    if (overflowY === "auto" || overflowY === "scroll") return parent;
  }
  return document.scrollingElement ?? document.documentElement;
}

/**
 * Brings a conversation's latest message into view (#601, ADR-0070): the thread scrolls in its own column (the page's
 * `<main>`), down to `end`, the thread's last line, so that nothing is left behind the box pinned at its foot (`foot`).
 * With `reply`, the AI Coach's reply that just arrived, never further than its first line: a reply taller than the
 * column shows from its start, under the Top Bar, and the Candidate reads on by scrolling. Never scrolls up.
 */
export function showLatest({ end, foot, reply }: { end: Element; foot: Element | null; reply: Element | null }): void {
  const scroller = scrollerOf(end);
  const isPage = scroller === document.scrollingElement || scroller === document.documentElement;
  const frame = isPage ? { top: 0, bottom: window.innerHeight } : scroller.getBoundingClientRect();
  const visibleBottom = foot ? Math.min(foot.getBoundingClientRect().top, frame.bottom) : frame.bottom;
  let by = end.getBoundingClientRect().top - visibleBottom;
  if (reply) {
    // A reply that fits shows whole, even with no room left above it; a taller one, from its first line, with some.
    const shown = reply.getBoundingClientRect();
    const fits = shown.height <= visibleBottom - frame.top;
    by = Math.min(by, shown.top - frame.top - (fits ? 0 : ABOVE_REPLY));
  }
  if (by <= 0) return;
  if (isPage) window.scrollBy(0, by);
  else scroller.scrollBy(0, by);
}
